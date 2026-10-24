import { describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../repositories/RepositoryError.js';
import { addTask } from './AddTask.js';
import { OFFLINE_GRACE_MS, authorizeUser } from './AuthorizeUser.js';
import { checkReminder } from './CheckReminder.js';
import { claimUid } from './ClaimUid.js';
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
        remember: vi.fn((uid, name, at) => {
          memory.remembered = { name, at };
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
    });
    expect(d.allowedUsers.find).toHaveBeenCalledWith('ana@x.com');
    expect(d.sessionStore.remember).toHaveBeenCalledWith('u1', 'Ana', NOW);
    expect(d.sessionStore.clearLegacy).toHaveBeenCalled();
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
      const remembered = { name: 'Ana', at: NOW - OFFLINE_GRACE_MS };
      expect(await authorizeUser(user(), deps({ error: unavailable, remembered }))).toEqual({
        status: 'ok',
        name: 'Ana',
        role: 'member',
        permissions: {},
        offline: true,
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
