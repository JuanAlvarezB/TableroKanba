import { describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../repositories/RepositoryError.js';
import { ALL_FEATURES, featureDefaults } from '../rules/features.js';
import { addTask } from './AddTask.js';
import { addSubtask } from './AddSubtask.js';
import { OFFLINE_GRACE_MS, authorizeUser } from './AuthorizeUser.js';
import { checkReminder } from './CheckReminder.js';
import { claimUid } from './ClaimUid.js';
import { completeTaskIndex } from './CompleteTaskIndex.js';
import { clearCompleted, deleteTask } from './DeleteTasks.js';
import { editSubtask } from './EditSubtask.js';
import { migrateLocalTasks } from './MigrateLocalTasks.js';
import { adjacentStatus, moveTask } from './MoveTask.js';
import { removeSubtask } from './RemoveSubtask.js';
import { reorderSubtask } from './ReorderSubtask.js';
import { setDueDate } from './SetDueDate.js';
import { setPriority } from './SetPriority.js';
import { toggleSubtask } from './ToggleSubtask.js';

const NOW = 1_790_000_000_000;

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

const board = () => [task('a', { order: 0 }), task('b', { order: 1 }), task('c', { order: 2, status: 'in-progress' })];

describe('addTask', () => {
  it('agrega la tarea al final sin modificar la lista recibida', () => {
    const tasks = board();
    const result = addTask(tasks, { id: 'n', text: 'Nueva', now: NOW });
    expect(result.task).toMatchObject({ id: 'n', status: 'pending', order: 3, createdAt: NOW });
    expect(result.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'n']);
    expect(tasks).toHaveLength(3);
  });

  it('la tarea nace con el evento de creación que recibe', () => {
    const history = [{ id: 'e1', type: 'create', at: NOW, text: 'Nueva' }];
    expect(addTask(board(), { id: 'n', text: 'Nueva', now: NOW, history }).task.history).toEqual(history);
  });
});

describe('moveTask', () => {
  it('al cambiar de columna registra las fechas y la pone al final', () => {
    const result = moveTask(board(), { id: 'a', status: 'in-progress', now: NOW });
    expect(result.ok).toBe(true);
    expect(result.changes).toEqual({ status: 'in-progress', order: 3, startedAt: NOW, completedAt: null });
    expect(result.tasks.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('al reordenar en la misma columna solo cambia el orden', () => {
    const result = moveTask(board(), { id: 'b', status: 'pending', beforeId: 'a', now: NOW });
    expect(result.changes).toEqual({ status: 'pending', order: -0.5 });
    expect(result.tasks.map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('respeta el límite WIP', () => {
    const full = Array.from({ length: 200 }, (_, i) => task(`p${i}`, { status: 'in-progress', order: i }));
    const result = moveTask([...full, task('x', { order: 300 })], { id: 'x', status: 'in-progress' });
    expect(result).toEqual({ ok: false, reason: 'wip-limit', limit: 200 });
  });

  it('avisa si la tarea no existe', () => {
    expect(moveTask(board(), { id: 'zzz', status: 'pending' })).toEqual({ ok: false, reason: 'not-found' });
  });

  it('adjacentStatus devuelve la columna vecina o null en los extremos', () => {
    expect(adjacentStatus(task('a'), 1)).toBe('in-progress');
    expect(adjacentStatus(task('a'), -1)).toBeNull();
    expect(adjacentStatus(task('a', { status: 'completed' }), 1)).toBeNull();
  });
});

describe('moveTask con subtareas', () => {
  const step = (id, done = false) => ({ id, text: `Paso ${id}`, done });
  const withSteps = (status, subtasks) => [task('a', { status, order: 0, subtasks, openSubtasks: 0 }), task('b')];

  it('no completa una tarea con pendientes y dice cuáles faltan, sin cambios', () => {
    for (const status of ['pending', 'in-progress']) {
      expect(moveTask(withSteps(status, [step('s1', true), step('s2')]), { id: 'a', status: 'completed' })).toEqual({
        ok: false,
        reason: 'open-subtasks',
        open: 1,
        total: 2,
        pending: ['Paso s2'],
      });
    }
  });

  it('completa desde cualquier columna si todas están terminadas', () => {
    for (const status of ['pending', 'in-progress']) {
      const result = moveTask(withSteps(status, [step('s1', true)]), { id: 'a', status: 'completed', now: NOW });
      expect(result.ok).toBe(true);
      expect(result.changes).toMatchObject({ status: 'completed', completedAt: NOW });
    }
  });

  it('Pendiente ↔ En curso y reordenar no se bloquean con pendientes', () => {
    const open = [step('s1')];
    expect(moveTask(withSteps('pending', open), { id: 'a', status: 'in-progress' }).ok).toBe(true);
    expect(moveTask(withSteps('in-progress', open), { id: 'a', status: 'pending' }).ok).toBe(true);
    expect(moveTask(withSteps('completed', open), { id: 'a', status: 'completed', beforeId: 'b' }).ok).toBe(true);
  });

  it('una tarea sin subtareas se completa igual que antes', () => {
    expect(moveTask(board(), { id: 'c', status: 'completed', now: NOW })).toMatchObject({
      ok: true,
      changes: { status: 'completed', completedAt: NOW },
    });
  });
});

describe('subtareas', () => {
  const step = (id, done = false, text = `Paso ${id}`) => ({ id, text, done });
  const withSteps = (subtasks, fields = {}) => [task('a', { subtasks, openSubtasks: 0, ...fields }), task('b')];

  it('addSubtask la agrega al final, pendiente, con el contador', () => {
    expect(
      addSubtask(withSteps([step('s1', true)]), { id: 'a', subtaskId: 's2', text: '  Llamar\nal proveedor ' }),
    ).toEqual({
      ok: true,
      changes: { subtasks: [step('s1', true), step('s2', false, 'Llamar al proveedor')], openSubtasks: 1 },
    });
    expect(addSubtask([task('a')], { id: 'a', subtaskId: 's1', text: 'Primero' }).changes.subtasks).toHaveLength(1);
  });

  it('addSubtask rechaza vacía, larga, la 21 y en una completada', () => {
    const list = withSteps([]);
    expect(addSubtask(list, { id: 'a', subtaskId: 'x', text: '   ' })).toEqual({ ok: false, reason: 'empty' });
    expect(addSubtask(list, { id: 'a', subtaskId: 'x', text: 'x'.repeat(201) })).toEqual({
      ok: false,
      reason: 'too-long',
    });
    const full = Array.from({ length: 20 }, (_, i) => step(`s${i}`));
    expect(addSubtask(withSteps(full), { id: 'a', subtaskId: 'x', text: 'Otra' })).toEqual({
      ok: false,
      reason: 'limit',
    });
    expect(addSubtask(withSteps([], { status: 'completed' }), { id: 'a', subtaskId: 'x', text: 'Otra' })).toEqual({
      ok: false,
      reason: 'completed',
    });
    expect(addSubtask(list, { id: 'zzz', subtaskId: 'x', text: 'Otra' })).toEqual({ ok: false, reason: 'not-found' });
  });

  it('editSubtask cambia el texto y rechaza vacío, sin cambios y en una completada', () => {
    const list = withSteps([step('s1'), step('s2', true)]);
    expect(editSubtask(list, { id: 'a', subtaskId: 's2', text: 'Nuevo' })).toEqual({
      ok: true,
      changes: { subtasks: [step('s1'), step('s2', true, 'Nuevo')], openSubtasks: 1 },
    });
    expect(editSubtask(list, { id: 'a', subtaskId: 's1', text: '' })).toEqual({ ok: false, reason: 'empty' });
    expect(editSubtask(list, { id: 'a', subtaskId: 's1', text: ' Paso s1 ' })).toEqual({
      ok: false,
      reason: 'unchanged',
    });
    expect(editSubtask(list, { id: 'a', subtaskId: 'zz', text: 'x' })).toEqual({ ok: false, reason: 'not-found' });
    expect(
      editSubtask(withSteps([step('s1', true)], { status: 'completed' }), { id: 'a', subtaskId: 's1', text: 'x' }),
    ).toEqual({ ok: false, reason: 'completed' });
  });

  it('toggleSubtask marca y desmarca sin mover la tarea, ni siquiera al terminar la última', () => {
    const list = withSteps([step('s1', true), step('s2')], { status: 'in-progress' });
    expect(toggleSubtask(list, { id: 'a', subtaskId: 's2', done: true, now: NOW })).toEqual({
      ok: true,
      changes: { subtasks: [step('s1', true), step('s2', true)], openSubtasks: 0 },
    });
    expect(toggleSubtask(list, { id: 'a', subtaskId: 's1', done: false })).toEqual({
      ok: true,
      changes: { subtasks: [step('s1'), step('s2')], openSubtasks: 2 },
    });
    expect(toggleSubtask(list, { id: 'a', subtaskId: 's1', done: true })).toEqual({ ok: false, reason: 'unchanged' });
    expect(toggleSubtask(list, { id: 'a', subtaskId: 'zz', done: true })).toEqual({ ok: false, reason: 'not-found' });
  });

  it('toggleSubtask en una completada pide reabrir y, al confirmar, la devuelve a En curso al final', () => {
    const list = withSteps([step('s1', true), step('s2', true)], { status: 'completed', startedAt: 5, completedAt: 9 });
    expect(toggleSubtask(list, { id: 'a', subtaskId: 's1', done: false })).toEqual({
      ok: false,
      reason: 'needs-reopen',
    });
    expect(toggleSubtask(list, { id: 'a', subtaskId: 's1', done: false, reopen: true, now: NOW })).toEqual({
      ok: true,
      changes: {
        subtasks: [step('s1'), step('s2', true)],
        openSubtasks: 1,
        status: 'in-progress',
        order: 1,
        startedAt: NOW,
        completedAt: null,
      },
    });
  });

  it('toggleSubtask no reabre si En curso está lleno (P-9)', () => {
    const full = Array.from({ length: 200 }, (_, i) => task(`p${i}`, { status: 'in-progress', order: i }));
    const done = task('a', { status: 'completed', order: 300, subtasks: [step('s1', true)], openSubtasks: 0 });
    expect(toggleSubtask([...full, done], { id: 'a', subtaskId: 's1', done: false, reopen: true })).toEqual({
      ok: false,
      reason: 'wip-limit',
      limit: 200,
    });
  });

  it('removeSubtask la quita y, sin ninguna, la tarea vuelve al flujo normal', () => {
    const list = withSteps([step('s1'), step('s2', true)]);
    expect(removeSubtask(list, { id: 'a', subtaskId: 's1' })).toEqual({
      ok: true,
      changes: { subtasks: [step('s2', true)], openSubtasks: 0 },
    });
    expect(removeSubtask(withSteps([step('s1')]), { id: 'a', subtaskId: 's1' }).changes).toEqual({
      subtasks: [],
      openSubtasks: 0,
    });
    expect(removeSubtask(list, { id: 'a', subtaskId: 'zz' })).toEqual({ ok: false, reason: 'not-found' });
    expect(removeSubtask(withSteps([step('s1', true)], { status: 'completed' }), { id: 'a', subtaskId: 's1' })).toEqual(
      {
        ok: false,
        reason: 'completed',
      },
    );
  });

  it('reorderSubtask sube y baja un puesto, y no pasa de los extremos', () => {
    const list = withSteps([step('s1'), step('s2', true), step('s3')]);
    expect(reorderSubtask(list, { id: 'a', subtaskId: 's2', direction: -1 }).changes.subtasks.map((s) => s.id)).toEqual(
      ['s2', 's1', 's3'],
    );
    expect(reorderSubtask(list, { id: 'a', subtaskId: 's2', direction: 1 }).changes.subtasks.map((s) => s.id)).toEqual([
      's1',
      's3',
      's2',
    ]);
    expect(reorderSubtask(list, { id: 'a', subtaskId: 's1', direction: -1 })).toEqual({ ok: false, reason: 'edge' });
    expect(reorderSubtask(list, { id: 'a', subtaskId: 's3', direction: 1 })).toEqual({ ok: false, reason: 'edge' });
    expect(
      reorderSubtask(withSteps([step('s1', true), step('s2', true)], { status: 'completed' }), {
        id: 'a',
        subtaskId: 's2',
        direction: -1,
      }),
    ).toEqual({ ok: false, reason: 'completed' });
  });

  it('ningún caso de uso cambia la lista recibida', () => {
    const list = withSteps([step('s1'), step('s2', true)]);
    const copy = structuredClone(list);
    addSubtask(list, { id: 'a', subtaskId: 's3', text: 'Otra' });
    editSubtask(list, { id: 'a', subtaskId: 's1', text: 'Otro' });
    toggleSubtask(list, { id: 'a', subtaskId: 's1', done: true });
    removeSubtask(list, { id: 'a', subtaskId: 's1' });
    reorderSubtask(list, { id: 'a', subtaskId: 's2', direction: -1 });
    expect(list).toEqual(copy);
  });
});

describe('etiquetas', () => {
  it('setPriority manda la tarea al final de su nuevo grupo', () => {
    expect(setPriority(board(), { id: 'a', priority: 'urgent' })).toEqual({ priority: 'urgent', order: 3 });
  });

  it('setPriority no cambia nada si la etiqueta es la misma o la tarea no existe', () => {
    expect(setPriority(board(), { id: 'a', priority: null })).toBeNull();
    expect(setPriority(board(), { id: 'zzz', priority: 'low' })).toBeNull();
  });

  it('setDueDate acepta fechas válidas y null para quitarla', () => {
    expect(setDueDate(board(), { id: 'a', dueDate: '2026-10-15' })).toEqual({ dueDate: '2026-10-15' });
    expect(setDueDate([task('a', { dueDate: '2026-10-15' })], { id: 'a', dueDate: null })).toEqual({ dueDate: null });
    expect(setDueDate(board(), { id: 'a', dueDate: '15/10/2026' })).toBeNull();
    expect(setDueDate(board(), { id: 'a', dueDate: null })).toBeNull();
  });
});

describe('borrar', () => {
  it('deleteTask quita una tarea', () => {
    expect(deleteTask(board(), { id: 'b' })).toMatchObject({ removedIds: ['b'] });
  });

  it('clearCompleted quita solo las completadas', () => {
    const tasks = [...board(), task('d', { status: 'completed' })];
    const result = clearCompleted(tasks);
    expect(result.removedIds).toEqual(['d']);
    expect(result.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('migrateLocalTasks', () => {
  const fakeCache = (migrated) => ({ migrated, isMigrated: () => migrated, markMigrated: vi.fn() });

  it('sube las tareas locales una sola vez y lo marca', async () => {
    const cache = fakeCache(false);
    const repository = { saveAll: vi.fn().mockResolvedValue() };
    expect(await migrateLocalTasks({ tasks: board(), cache, repository })).toBe(true);
    expect(repository.saveAll).toHaveBeenCalledWith(board());
    expect(cache.markMigrated).toHaveBeenCalled();
  });

  it('no sube nada si ya se migró o no hay tareas', async () => {
    const repository = { saveAll: vi.fn() };
    expect(await migrateLocalTasks({ tasks: board(), cache: fakeCache(true), repository })).toBe(false);
    expect(await migrateLocalTasks({ tasks: [], cache: fakeCache(false), repository })).toBe(false);
    expect(repository.saveAll).not.toHaveBeenCalled();
  });

  it('si falla la subida no lo marca como migrado', async () => {
    const cache = fakeCache(false);
    const repository = { saveAll: vi.fn().mockRejectedValue(new Error('sin red')) };
    await expect(migrateLocalTasks({ tasks: board(), cache, repository })).rejects.toThrow('sin red');
    expect(cache.markMigrated).not.toHaveBeenCalled();
  });
});

describe('completeTaskIndex', () => {
  const fakeCache = (complete) => ({ isIndexComplete: () => complete, markIndexComplete: vi.fn() });
  const fakeRepository = (indexed) => ({
    indexedIds: vi.fn().mockResolvedValue(indexed),
    addToIndex: vi.fn().mockResolvedValue(),
    removeFromIndex: vi.fn().mockResolvedValue(),
  });

  it('crea los índices que faltan, borra los huérfanos y lo marca con la hora', async () => {
    const cache = fakeCache(false);
    const repository = fakeRepository(['a', 'huerfano']);
    const result = await completeTaskIndex({ currentTasks: board, cache, repository, now: NOW });
    expect(result).toEqual({ created: 2, removed: 1 });
    expect(repository.addToIndex).toHaveBeenCalledWith(['b', 'c']);
    expect(repository.removeFromIndex).toHaveBeenCalledWith(['huerfano']);
    expect(cache.markIndexComplete).toHaveBeenCalledWith(NOW);
  });

  it('con el índice al día no escribe nada, pero lo marca', async () => {
    const cache = fakeCache(false);
    const repository = fakeRepository(['a', 'b', 'c']);
    expect(await completeTaskIndex({ currentTasks: board, cache, repository, now: NOW })).toEqual({
      created: 0,
      removed: 0,
    });
    expect(repository.addToIndex).toHaveBeenCalledWith([]);
    expect(repository.removeFromIndex).toHaveBeenCalledWith([]);
    expect(cache.markIndexComplete).toHaveBeenCalled();
  });

  it('si ya estaba completo no lee ni escribe nada', async () => {
    const repository = fakeRepository([]);
    const currentTasks = vi.fn(board);
    expect(await completeTaskIndex({ currentTasks, cache: fakeCache(true), repository, now: NOW })).toBeNull();
    expect(repository.indexedIds).not.toHaveBeenCalled();
    expect(currentTasks).not.toHaveBeenCalled();
  });

  it('compara con las tareas de después de leer el índice', async () => {
    let tasks = [task('a')];
    const repository = fakeRepository([]);
    repository.indexedIds.mockImplementation(async () => {
      tasks = [task('a'), task('nueva')];
      return ['nueva'];
    });
    await completeTaskIndex({ currentTasks: () => tasks, cache: fakeCache(false), repository, now: NOW });
    expect(repository.addToIndex).toHaveBeenCalledWith(['a']);
    expect(repository.removeFromIndex).toHaveBeenCalledWith([]);
  });

  it('si falla no lo marca, para reintentarlo en la siguiente sesión', async () => {
    const cache = fakeCache(false);
    const repository = fakeRepository([]);
    repository.addToIndex.mockRejectedValue(new RepositoryError('unavailable'));
    await expect(completeTaskIndex({ currentTasks: board, cache, repository, now: NOW })).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(cache.markIndexComplete).not.toHaveBeenCalled();

    repository.indexedIds.mockRejectedValue(new RepositoryError('permission-denied'));
    await expect(completeTaskIndex({ currentTasks: board, cache, repository, now: NOW })).rejects.toMatchObject({
      reason: 'permission-denied',
    });
  });
});

describe('checkReminder', () => {
  // Miércoles 7 de octubre de 2026, 10:30.
  const now = new Date(2026, 9, 7, 10, 30);
  const urgent = [task('u', { priority: 'urgent', createdAt: now.getTime() })];

  it('muestra el turno si hay tareas que necesitan atención y no se ha mostrado', () => {
    expect(checkReminder(urgent, { lastShownId: null, now })).toEqual({ id: '2026-10-7@10', label: 'de la mañana' });
  });

  it('no lo repite en el mismo turno', () => {
    expect(checkReminder(urgent, { lastShownId: '2026-10-7@10', now })).toBeNull();
  });

  it('no lo muestra si no hay nada que atender', () => {
    expect(checkReminder([task('a', { createdAt: now.getTime() })], { lastShownId: null, now })).toBeNull();
  });

  it('con reminders apagada no muestra nada', () => {
    expect(
      checkReminder(urgent, { lastShownId: null, now, features: { ...ALL_FEATURES, reminders: false } }),
    ).toBeNull();
  });

  it('solo cuentan los grupos de las funciones activas', () => {
    const features = { ...ALL_FEATURES, priorities: false };
    expect(checkReminder(urgent, { lastShownId: null, now, features })).toBeNull();
    const dueToday = [task('v', { dueDate: '2026-10-07', createdAt: now.getTime() })];
    expect(checkReminder(dueToday, { lastShownId: null, now, features })).toEqual({
      id: '2026-10-7@10',
      label: 'de la mañana',
    });
  });
});

describe('authorizeUser', () => {
  const user = (fields = {}) => ({ uid: 'u1', email: 'Ana@X.com', emailVerified: true, isAnonymous: false, ...fields });
  const person = (fields = {}) => ({
    email: 'ana@x.com',
    name: 'Ana',
    role: 'member',
    active: true,
    uid: 'u1',
    permissions: {},
    ...fields,
  });

  // Repositorios falsos: allowedUsers devuelve `found` (o lanza `error`); sessionStore guarda en memoria.
  function deps({ found = person(), error = null, remembered = null } = {}) {
    const memory = { remembered };
    return {
      allowedUsers: {
        find: vi.fn(async () => {
          if (error) throw error;
          return found;
        }),
        claimUid: vi.fn(async () => {}),
      },
      sessionStore: {
        remembered: () => memory.remembered,
        remember: vi.fn((uid, name, at, features) => {
          memory.remembered = { name, at, features };
        }),
        forget: vi.fn(() => {
          memory.remembered = null;
        }),
        clearLegacy: vi.fn(),
      },
      now: NOW,
    };
  }

  it('activo: entra con su rol y sus permisos, y recuerda la autorización con la hora', async () => {
    const d = deps({ found: person({ role: 'admin', permissions: { tablero: true } }) });
    expect(await authorizeUser(user(), d)).toEqual({
      status: 'ok',
      name: 'Ana',
      role: 'admin',
      permissions: { tablero: true },
      features: ALL_FEATURES,
    });
    expect(d.allowedUsers.find).toHaveBeenCalledWith('ana@x.com');
    expect(d.sessionStore.remember).toHaveBeenCalledWith('u1', 'Ana', NOW, ALL_FEATURES);
    expect(d.sessionStore.clearLegacy).toHaveBeenCalled();
  });

  it('un miembro recibe sus permisos efectivos con los valores iniciales del ambiente y se recuerdan', async () => {
    const d = {
      ...deps({ found: person({ permissions: { priorities: false } }) }),
      defaults: featureDefaults({ reminders: false }),
    };
    const features = { ...ALL_FEATURES, priorities: false, reminders: false };
    expect(await authorizeUser(user(), d)).toMatchObject({ status: 'ok', role: 'member', features });
    // Se recuerdan los permisos efectivos, nunca el rol.
    expect(d.sessionStore.remember).toHaveBeenCalledWith('u1', 'Ana', NOW, features);
  });

  it('con el tablero apagado, las hijas también lo están', async () => {
    const d = deps({ found: person({ permissions: { board: false, history: true } }) });
    const { features } = await authorizeUser(user(), d);
    expect(Object.values(features).every((value) => value === false)).toBe(true);
  });

  it('un documento legado entra como miembro', async () => {
    const legacy = { email: 'ana@x.com', name: 'Ana', role: 'member', active: true, uid: null, permissions: {} };
    expect(await authorizeUser(user(), deps({ found: legacy }))).toMatchObject({ status: 'ok', role: 'member' });
  });

  it('sin documento: denied y olvida lo recordado', async () => {
    const d = deps({ found: null, remembered: { name: 'Ana', at: NOW } });
    expect(await authorizeUser(user(), d)).toEqual({ status: 'denied' });
    expect(d.sessionStore.forget).toHaveBeenCalledWith('u1');
  });

  it('desactivada: inactive (aunque no haya verificado el correo) y olvida lo recordado', async () => {
    const d = deps({ found: person({ active: false }), remembered: { name: 'Ana', at: NOW } });
    expect(await authorizeUser(user({ emailVerified: false }), d)).toEqual({ status: 'inactive' });
    expect(d.sessionStore.forget).toHaveBeenCalledWith('u1');
    expect(d.allowedUsers.claimUid).not.toHaveBeenCalled();
  });

  it('activa sin correo verificado: unverified', async () => {
    expect(await authorizeUser(user({ emailVerified: false }), deps())).toEqual({ status: 'unverified' });
  });

  it('otro uid registrado: denied, sin sobrescribirlo', async () => {
    const d = deps({ found: person({ uid: 'otro' }) });
    expect(await authorizeUser(user(), d)).toEqual({ status: 'denied' });
    expect(d.allowedUsers.claimUid).not.toHaveBeenCalled();
    expect(d.sessionStore.remember).not.toHaveBeenCalled();
  });

  it('sin correo o anónima: denied sin consultar', async () => {
    const d = deps();
    expect(await authorizeUser(user({ email: null }), d)).toEqual({ status: 'denied' });
    expect(await authorizeUser(user({ isAnonymous: true }), d)).toEqual({ status: 'denied' });
    expect(d.allowedUsers.find).not.toHaveBeenCalled();
  });

  it('si las reglas niegan la lectura: denied', async () => {
    const d = deps({ error: new RepositoryError('permission-denied'), remembered: { name: 'Ana', at: NOW } });
    expect(await authorizeUser(user(), d)).toEqual({ status: 'denied' });
  });

  describe('sin conexión', () => {
    const unavailable = new RepositoryError('unavailable');

    it('con una autorización de menos de 7 días entra, siempre como miembro', async () => {
      const remembered = { name: 'Ana', at: NOW - OFFLINE_GRACE_MS, features: ALL_FEATURES };
      expect(await authorizeUser(user(), deps({ error: unavailable, remembered }))).toEqual({
        status: 'ok',
        name: 'Ana',
        role: 'member',
        permissions: {},
        features: ALL_FEATURES,
        offline: true,
      });
    });

    it('aplica los últimos permisos conocidos', async () => {
      const remembered = { name: 'Ana', at: NOW, features: { ...ALL_FEATURES, board: false } };
      const { features } = await authorizeUser(user(), deps({ error: unavailable, remembered }));
      expect(features.board).toBe(false);
      expect(features.priorities).toBe(false);
    });

    it('sin permisos recordados (formato anterior) aplica los valores iniciales del ambiente', async () => {
      const d = {
        ...deps({ error: unavailable, remembered: { name: 'Ana', at: NOW } }),
        defaults: featureDefaults({ history: false }),
      };
      expect(await authorizeUser(user(), d)).toMatchObject({
        status: 'ok',
        features: { ...ALL_FEATURES, history: false },
      });
    });

    it('con una de más de 7 días muestra "sin conexión"', async () => {
      const remembered = { name: 'Ana', at: NOW - OFFLINE_GRACE_MS - 1 };
      expect(await authorizeUser(user(), deps({ error: unavailable, remembered }))).toEqual({
        status: 'offline',
        error: unavailable,
      });
    });

    it('acepta el formato anterior, sin hora', async () => {
      const result = await authorizeUser(user(), deps({ error: unavailable, remembered: { name: 'Ana' } }));
      expect(result).toMatchObject({ status: 'ok', offline: true });
    });

    it('sin nada recordado muestra "sin conexión"', async () => {
      expect(await authorizeUser(user(), deps({ error: unavailable }))).toMatchObject({ status: 'offline' });
    });
  });

  describe('registro del uid', () => {
    it('lo registra cuando falta', async () => {
      const d = deps({ found: person({ uid: null }) });
      expect(await authorizeUser(user(), d)).toMatchObject({ status: 'ok' });
      expect(d.allowedUsers.claimUid).toHaveBeenCalledWith('ana@x.com', 'u1');
    });

    it('no lo vuelve a escribir cuando ya está', async () => {
      const d = deps();
      await authorizeUser(user(), d);
      expect(d.allowedUsers.claimUid).not.toHaveBeenCalled();
    });

    it('si falla, la persona entra igual y el error queda para la consola', async () => {
      const d = deps({ found: person({ uid: null }) });
      const error = new RepositoryError('permission-denied');
      d.allowedUsers.claimUid.mockRejectedValue(error);
      expect(await authorizeUser(user(), d)).toMatchObject({ status: 'ok', name: 'Ana', claimError: error });
    });
  });
});

describe('claimUid', () => {
  const allowedUsers = () => ({ claimUid: vi.fn(async () => {}) });
  const person = (uid) => ({ email: 'ana@x.com', name: 'Ana', role: 'member', active: true, uid, permissions: {} });

  it('escribe el uid de la sesión si el documento no lo tiene', async () => {
    const repository = allowedUsers();
    expect(await claimUid({ uid: 'u1' }, person(null), { allowedUsers: repository })).toEqual({ status: 'claimed' });
    expect(repository.claimUid).toHaveBeenCalledWith('ana@x.com', 'u1');
  });

  it('no hace nada si ya está registrado', async () => {
    const repository = allowedUsers();
    expect(await claimUid({ uid: 'u1' }, person('u1'), { allowedUsers: repository })).toEqual({ status: 'skipped' });
    expect(repository.claimUid).not.toHaveBeenCalled();
  });

  it('no lanza si falla: devuelve el error', async () => {
    const repository = allowedUsers();
    repository.claimUid.mockRejectedValue(new Error('sin red'));
    const result = await claimUid({ uid: 'u1' }, person(null), { allowedUsers: repository });
    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
  });
});
