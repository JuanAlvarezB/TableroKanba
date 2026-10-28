import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVED_WITHOUT_HISTORY } from '../../data/repositories/LocalTaskCache.js';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { BOARD_MESSAGES } from '../../shared/constants/messages.js';
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
    indexCompletedAt: 1,
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
    isIndexComplete() {
      return this.indexCompletedAt !== null;
    },
    markIndexComplete(at) {
      this.indexCompletedAt = at;
    },
  };
}

function fakeRepository() {
  return {
    save: vi.fn().mockResolvedValue(),
    update: vi.fn().mockResolvedValue(),
    remove: vi.fn().mockResolvedValue(),
    saveAll: vi.fn().mockResolvedValue(),
    indexedIds: vi.fn().mockResolvedValue([]),
    addToIndex: vi.fn().mockResolvedValue(),
    removeFromIndex: vi.fn().mockResolvedValue(),
    subscribe: vi.fn(() => vi.fn()),
  };
}

// Registra los eventos del store en orden.
function record(store) {
  const events = [];
  ['change', 'notice', 'highlight', 'added', 'edited', 'sync', 'access-lost'].forEach((type) =>
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

  it('si la copia local solo cabe sin el historial, avisa una sola vez', () => {
    const store = createBoardStore({ newId });
    const cache = fakeCache();
    cache.save = () => SAVED_WITHOUT_HISTORY;
    store.loadLocal(cache);
    const events = record(store);
    store.add('a');
    store.add('b');
    expect(events.filter(([type]) => type === 'notice')).toEqual([['notice', BOARD_MESSAGES.historyNotStored]]);
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
    expect(repository.update).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ status: 'in-progress' }),
      expect.objectContaining({ mode: 'append' }),
    );
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

  it('si las reglas rechazan una operación avisa que quizá se perdió el acceso', async () => {
    const { store, repository, events, onError } = connected();
    repository.save.mockRejectedValue(new RepositoryError('permission-denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.add('a');
    onError(new RepositoryError('permission-denied'));
    await new Promise((resolve) => setTimeout(resolve));
    expect(events.filter(([type]) => type === 'access-lost')).toHaveLength(2);
  });

  it('sin conexión no avisa de acceso perdido', async () => {
    const { store, repository, events } = connected();
    repository.save.mockRejectedValue(new RepositoryError('unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.add('a');
    await new Promise((resolve) => setTimeout(resolve));
    expect(events.map(([type]) => type)).not.toContain('access-lost');
  });

  it('completa el índice una sola vez, con el primer snapshot del servidor', async () => {
    const { cache, repository, onChange } = connected([task('local')]);
    cache.indexCompletedAt = null;
    repository.indexedIds.mockResolvedValue(['huerfano']);
    onChange({ tasks: [], added: [], fromCache: true });
    expect(repository.indexedIds).not.toHaveBeenCalled();

    onChange({ tasks: [task('a'), task('b')], added: [], fromCache: false });
    onChange({ tasks: [task('a'), task('b'), task('c')], added: [task('c')], fromCache: false });
    await new Promise((resolve) => setTimeout(resolve));
    expect(repository.indexedIds).toHaveBeenCalledTimes(1);
    expect(repository.addToIndex).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(repository.removeFromIndex).toHaveBeenCalledWith(['huerfano']);
    expect(cache.indexCompletedAt).toEqual(expect.any(Number));
  });

  it('con el índice ya completo no lo vuelve a leer', async () => {
    const { repository, onChange } = connected();
    onChange({ tasks: [task('a')], added: [], fromCache: false });
    await new Promise((resolve) => setTimeout(resolve));
    expect(repository.indexedIds).not.toHaveBeenCalled();
  });

  it('si no puede completar el índice no avisa ni se desconecta', async () => {
    const { cache, repository, events, onChange } = connected();
    cache.indexCompletedAt = null;
    repository.indexedIds.mockRejectedValue(new RepositoryError('unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onChange({ tasks: [task('a')], added: [], fromCache: false });
    await new Promise((resolve) => setTimeout(resolve));
    expect(warn).toHaveBeenCalled();
    expect(cache.indexCompletedAt).toBeNull();
    expect(events.map(([type]) => type)).not.toContain('notice');
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

describe('boardStore: historial', () => {
  const NOW = 1_790_000_000_000;
  let events;
  beforeEach(() => {
    events = 0;
  });
  const newEventId = () => `ev-${++events}`;

  function connected(initial) {
    const store = createBoardStore({ newId, newEventId, now: () => NOW });
    const cache = fakeCache(initial);
    store.loadLocal(cache);
    const repository = fakeRepository();
    store.connect(repository);
    const [onChange] = repository.subscribe.mock.calls[0];
    onChange({ tasks: structuredClone(initial), added: [], fromCache: false });
    return { store, cache, repository, onChange };
  }

  const recorded = { id: 'r1', type: 'create', at: 1, text: 'a' };
  const withHistory = (id, fields = {}) => task(id, { history: [recorded], ...fields });
  const lastUpdate = (repository) => repository.update.mock.calls.at(-1);

  it('add crea la tarea con su evento create', () => {
    const { store, repository, cache } = connected([]);
    store.add('Comprar pan');
    const created = { id: 'ev-1', type: 'create', at: NOW, text: 'Comprar pan' };
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ createdAt: NOW, history: [created] }));
    expect(cache.stored[0].history).toEqual([created]);
  });

  it('move añade el evento en la misma escritura y lo aplica a la tarea local', () => {
    const { store, repository, cache } = connected([withHistory('a')]);
    store.move('a', 'in-progress');
    const moved = { id: 'ev-1', type: 'move', at: NOW, from: 'pending', to: 'in-progress' };
    expect(lastUpdate(repository)).toEqual([
      'a',
      { status: 'in-progress', order: 0, startedAt: NOW, completedAt: null },
      { mode: 'append', events: [moved] },
    ]);
    expect(store.tasks[0].history).toEqual([recorded, moved]);
    expect(cache.stored[0].history).toEqual([recorded, moved]);
  });

  it('una tarea sin history materializa los derivados de sus fechas con el primer cambio', () => {
    const { store, repository } = connected([task('a', { createdAt: 10, history: null })]);
    store.move('a', 'in-progress');
    expect(lastUpdate(repository)[2]).toEqual({
      mode: 'append',
      events: [
        { id: 'd:pending:10', type: 'move', at: 10, from: null, to: 'pending', derived: true },
        { id: 'ev-1', type: 'move', at: NOW, from: 'pending', to: 'in-progress' },
      ],
    });
  });

  it('reordenar dentro de la misma columna escribe el orden sin eventos', () => {
    const { store, repository } = connected([withHistory('a', { order: 0 }), withHistory('b', { order: 1 })]);
    store.move('b', 'pending', 'a');
    expect(lastUpdate(repository)).toEqual(['b', { status: 'pending', order: -0.5 }, null]);
    expect(store.tasks.find((t) => t.id === 'b').history).toEqual([recorded]);
  });

  it('un movimiento rechazado por el límite WIP no escribe ni genera eventos', () => {
    const full = Array.from({ length: 200 }, (_, i) =>
      withHistory(`p${i}`, { status: 'in-progress', order: i, startedAt: 1 }),
    );
    const { store, repository } = connected([...full, withHistory('x', { order: 300 })]);
    store.move('x', 'in-progress');
    expect(repository.update).not.toHaveBeenCalled();
    expect(store.tasks.find((t) => t.id === 'x').history).toEqual([recorded]);
  });

  it('editText, setPriority y setDueDate envían su evento con el valor anterior y el nuevo', () => {
    const { store, repository } = connected([withHistory('a', { text: 'Antes' })]);
    store.editText('a', 'Después');
    expect(lastUpdate(repository)).toEqual([
      'a',
      { text: 'Después' },
      { mode: 'append', events: [{ id: 'ev-1', type: 'edit', at: NOW, from: 'Antes', to: 'Después' }] },
    ]);
    store.setPriority('a', 'urgent');
    expect(lastUpdate(repository)[2].events).toEqual([
      { id: 'ev-2', type: 'priority', at: NOW, from: null, to: 'urgent' },
    ]);
    store.setDueDate('a', '2026-10-15');
    store.setDueDate('a', null);
    expect(lastUpdate(repository)[2].events).toEqual([
      { id: 'ev-4', type: 'due', at: NOW, from: '2026-10-15', to: null },
    ]);
    expect(store.tasks[0].history.map((event) => event.type)).toEqual(['create', 'edit', 'priority', 'due', 'due']);
  });

  it('sin cambios no hay eventos', () => {
    const { store, repository } = connected([withHistory('a', { text: 'Igual', priority: 'low' })]);
    store.editText('a', 'Igual');
    expect(lastUpdate(repository)).toEqual(['a', { text: 'Igual' }, null]);
    store.setPriority('a', 'low');
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it('desde 90 eventos compacta a los 60 más recientes más el nuevo', () => {
    const history = Array.from({ length: 90 }, (_, i) => ({
      ...recorded,
      id: `r${i}`,
      type: 'edit',
      from: 'a',
      to: 'b',
    }));
    const { store, repository } = connected([task('a', { history })]);
    store.editText('a', 'Nueva');
    const [, , plan] = lastUpdate(repository);
    expect(plan.mode).toBe('replace');
    expect(plan.history).toHaveLength(61);
    expect(plan.history[0].id).toBe('r30');
    expect(store.tasks[0].history).toEqual(plan.history);
  });

  it('completar fechas ausentes no genera eventos', () => {
    const { repository } = connected([task('a', { createdAt: null, history: null })]);
    expect(repository.update).toHaveBeenCalledWith('a', { createdAt: NOW }, null);
  });
});
