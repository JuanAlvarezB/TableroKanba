import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { createBoardStore } from './boardStore.js';

const task = (id, fields = {}) => ({
  id,
  text: id,
  status: 'pending',
  order: 0,
  createdAt: 1,
  startedAt: null,
  completedAt: null,
  priority: null,
  dueDate: null,
  ...fields,
});

function fakeCache(initial = []) {
  return {
    tasksKey: 'tareas-dev-u1',
    stored: initial,
    migrated: true,
    load() {
      return structuredClone(this.stored);
    },
    save(tasks) {
      this.stored = structuredClone(tasks);
      return true;
    },
    isMigrated() {
      return this.migrated;
    },
    markMigrated() {
      this.migrated = true;
    },
  };
}

function fakeRepository() {
  return {
    save: vi.fn().mockResolvedValue(),
    update: vi.fn().mockResolvedValue(),
    remove: vi.fn().mockResolvedValue(),
    saveAll: vi.fn().mockResolvedValue(),
    subscribe: vi.fn(() => vi.fn()),
  };
}

// Registra los eventos del store en orden.
function record(store) {
  const events = [];
  ['change', 'notice', 'highlight', 'added', 'edited', 'sync'].forEach((type) =>
    store.on(type, (payload) => events.push([type, payload])),
  );
  return events;
}

let ids;
beforeEach(() => {
  ids = 0;
});
const newId = () => `nueva-${++ids}`;

describe('boardStore sin conexión', () => {
  it('carga la copia local ordenada y avisa que cambió', () => {
    const store = createBoardStore({ newId });
    const events = record(store);
    store.loadLocal(fakeCache([task('b', { order: 1 }), task('a', { order: 0 })]));
    expect(store.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(events).toEqual([['change', undefined]]);
  });

  it('agregar guarda en local, redibuja y luego anuncia', () => {
    const store = createBoardStore({ newId });
    const cache = fakeCache();
    store.loadLocal(cache);
    const events = record(store);
    store.add('Comprar pan');
    expect(cache.stored.map((t) => t.text)).toEqual(['Comprar pan']);
    expect(events.map(([type]) => type)).toEqual(['change', 'added']);
  });

  it('avisa del límite WIP sin cambiar nada', () => {
    const full = Array.from({ length: 200 }, (_, i) => task(`p${i}`, { status: 'in-progress', order: i }));
    const store = createBoardStore({ newId });
    store.loadLocal(fakeCache([...full, task('x', { order: 300 })]));
    const events = record(store);
    store.move('x', 'in-progress');
    expect(events).toEqual([['notice', expect.stringContaining('Límite WIP')]]);
  });

  it('setPriority resalta la tarea y la manda al final de su grupo', () => {
    const store = createBoardStore({ newId });
    store.loadLocal(fakeCache([task('a', { order: 0 }), task('b', { order: 1 })]));
    const events = record(store);
    store.setPriority('a', 'urgent');
    expect(store.tasks.map((t) => t.id)).toEqual(['b', 'a']);
    expect(events).toEqual([
      ['highlight', ['a']],
      ['change', undefined],
    ]);
  });

  it('avisa si el navegador no deja guardar', () => {
    const store = createBoardStore({ newId });
    const cache = fakeCache();
    cache.save = () => false;
    store.loadLocal(cache);
    const events = record(store);
    store.add('x');
    expect(events[0]).toEqual(['notice', 'No se pudieron guardar los cambios en este navegador.']);
  });

  it('sincroniza las pestañas del mismo navegador sin Firestore', () => {
    const store = createBoardStore({ newId });
    const cache = fakeCache([task('a')]);
    store.loadLocal(cache);
    const events = record(store);
    cache.stored = [task('a', { text: 'editada' }), task('b')];
    store.reloadFromStorage('otra-clave');
    expect(events).toEqual([]);
    store.reloadFromStorage(cache.tasksKey);
    expect(events.map(([type]) => type)).toEqual(['highlight', 'edited', 'change', 'added']);
  });
});

describe('boardStore con Firestore', () => {
  function connected(initial = []) {
    const store = createBoardStore({ newId });
    const cache = fakeCache(initial);
    store.loadLocal(cache);
    const repository = fakeRepository();
    const events = record(store);
    store.connect(repository);
    const [onChange, onError] = repository.subscribe.mock.calls[0];
    return { store, cache, repository, events, onChange, onError };
  }

  it('ignora el primer snapshot de la caché para no borrar la copia local', () => {
    const { store, onChange } = connected([task('local')]);
    onChange({ tasks: [], added: [], fromCache: true });
    expect(store.tasks.map((t) => t.id)).toEqual(['local']);
  });

  it('aplica el snapshot del servidor y anuncia solo los cambios ajenos posteriores', () => {
    const { store, events, onChange } = connected();
    onChange({ tasks: [task('a')], added: [task('a')], fromCache: false });
    expect(store.tasks.map((t) => t.id)).toEqual(['a']);
    expect(events.map(([type]) => type)).toEqual(['sync', 'change', 'sync']);

    events.length = 0;
    onChange({ tasks: [task('a', { text: 'otra' }), task('b')], added: [task('b')], fromCache: false });
    expect(events.map(([type]) => type)).toEqual(['highlight', 'edited', 'change', 'sync', 'added']);
  });

  it('guarda en Firestore lo que cambia en el tablero', () => {
    const { store, repository, onChange } = connected();
    onChange({ tasks: [task('a')], added: [], fromCache: false });
    store.add('Nueva');
    store.move('a', 'in-progress');
    store.delete('nueva-1');
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'nueva-1', text: 'Nueva' }));
    expect(repository.update).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'in-progress' }));
    expect(repository.remove).toHaveBeenCalledWith(['nueva-1']);
  });

  it('sin conexión pasa a "Solo en este dispositivo" y avisa una sola vez', async () => {
    const { store, repository, events } = connected();
    repository.save.mockRejectedValue(new RepositoryError('unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.add('a');
    store.add('b');
    await new Promise((resolve) => setTimeout(resolve));
    const notices = events.filter(([type]) => type === 'notice');
    expect(notices).toHaveLength(1);
    expect(events).toContainEqual(['sync', 'offline']);
  });

  it('si las reglas rechazan el cambio lo explica sin desconectar', async () => {
    const { store, repository, events } = connected();
    repository.save.mockRejectedValue(new RepositoryError('permission-denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.add('a');
    await new Promise((resolve) => setTimeout(resolve));
    expect(events).toContainEqual(['notice', expect.stringContaining('reglas de seguridad')]);
    expect(events).not.toContainEqual(['sync', 'offline']);
  });

  it('al desconectar deja de escuchar y de guardar', () => {
    const { store, cache, repository } = connected([task('a')]);
    const stop = repository.subscribe.mock.results[0].value;
    store.disconnect();
    expect(stop).toHaveBeenCalled();
    const before = cache.stored;
    store.add('después');
    expect(repository.save).not.toHaveBeenCalled();
    expect(cache.stored).toBe(before);
  });
});
