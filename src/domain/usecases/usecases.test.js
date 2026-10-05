import { describe, expect, it, vi } from 'vitest';
import { addTask } from './AddTask.js';
import { checkReminder } from './CheckReminder.js';
import { clearCompleted, deleteTask } from './DeleteTasks.js';
import { migrateLocalTasks } from './MigrateLocalTasks.js';
import { adjacentStatus, moveTask } from './MoveTask.js';
import { setDueDate } from './SetDueDate.js';
import { setPriority } from './SetPriority.js';

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
});
