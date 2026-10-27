import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStore } from '../data/repositories/SessionStore.js';
import { RepositoryError } from '../domain/repositories/RepositoryError.js';
import { authorizeUser } from '../domain/usecases/AuthorizeUser.js';
import { stepLabel } from './components/TaskHistory.js';
import { dueInfo, formatDate } from './format/dates.js';
import { plural } from './format/labels.js';

const WEDNESDAY = new Date(2026, 9, 7, 10, 30);
const pending = (dueDate) => ({ status: 'pending', dueDate });

describe('textos de vencimiento', () => {
  it.each([
    ['2026-10-05', 'overdue', '⛔ Venció hace 2 días'],
    ['2026-10-06', 'overdue', '⛔ Venció hace 1 día'],
    ['2026-10-07', 'soon', '⏳ Vence hoy'],
    ['2026-10-08', 'soon', '⏳ Vence mañana'],
    ['2026-10-09', 'soon', '⏳ Vence en 2 días'],
  ])('%s → %s', (dueDate, kind, text) => {
    expect(dueInfo(pending(dueDate), WEDNESDAY)).toMatchObject({ kind, text });
  });

  it('las fechas con margen muestran el día', () => {
    const info = dueInfo(pending('2026-10-20'), WEDNESDAY);
    expect(info.kind).toBe('scheduled');
    expect(info.text).toMatch(/^📅 Vence el 20 oct/);
    expect(info.title).toMatch(/^Fecha límite: martes, 20 de octubre de 2026/);
  });

  it('el año solo aparece si no es el actual', () => {
    expect(formatDate(new Date(2026, 0, 5, 9, 0).getTime(), WEDNESDAY)).not.toMatch(/2026/);
    expect(formatDate(new Date(2025, 0, 5, 9, 0).getTime(), WEDNESDAY)).toMatch(/2025/);
  });

  it('plural', () => {
    expect(plural(1, 'tarea', 'tareas')).toBe('1 tarea');
    expect(plural(3, 'tarea', 'tareas')).toBe('3 tareas');
  });
});

describe('historial de la tarjeta', () => {
  // B-4.1: en una tarea devuelta, createdAt es la fecha del regreso a Pendiente.
  it('la fecha de Pendiente dice "Creada" salvo en las tareas devueltas', () => {
    const fresh = { status: 'pending', createdAt: 1000, startedAt: null, completedAt: null };
    const returned = { status: 'pending', createdAt: 3000, startedAt: 2000, completedAt: null };
    const started = { status: 'in-progress', createdAt: 1000, startedAt: 2000, completedAt: null };
    expect(stepLabel(fresh, 'pending')).toBe('Creada');
    expect(stepLabel(returned, 'pending')).toBe('En Pendiente desde');
    expect(stepLabel(started, 'pending')).toBe('Creada');
    expect(stepLabel(started, 'in-progress')).toBe('En curso');
  });
});

describe('authorizeUser y SessionStore', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const env = { name: 'dev', storageKey: 'tareas-dev', migratedKey: 'tareas-migradas-dev' };
  const user = (fields = {}) => ({ uid: 'u1', email: 'Ana@X.com', emailVerified: true, isAnonymous: false, ...fields });
  const member = (fields = {}) => ({
    email: 'ana@x.com',
    name: 'Ana',
    role: 'member',
    active: true,
    uid: 'u1',
    permissions: {},
    ...fields,
  });
  const allowed = (result) => ({ find: vi.fn(async () => result), claimUid: vi.fn(async () => {}) });

  it('usa claves con el ambiente y el uid', () => {
    expect(createSessionStore(env).keysFor('u1')).toEqual({
      tasks: 'tareas-dev-u1',
      migrated: 'tareas-migradas-dev-u1',
      authorized: 'lucas-autorizado-dev-u1',
    });
  });

  it('autoriza, recuerda el nombre y borra las copias del tablero anónimo', async () => {
    store.set('tareas-dev', '[]');
    const allowedUsers = allowed(member());
    const sessionStore = createSessionStore(env);
    expect(await authorizeUser(user(), { allowedUsers, sessionStore, now: 1000 })).toEqual({
      status: 'ok',
      name: 'Ana',
      role: 'member',
      permissions: {},
    });
    expect(allowedUsers.find).toHaveBeenCalledWith('ana@x.com');
    expect(sessionStore.remembered('u1')).toEqual({ name: 'Ana', at: 1000 });
    expect(store.has('tareas-dev')).toBe(false);
  });

  it('rechaza a quien no está autorizado y borra sus datos locales', async () => {
    store.set('tareas-dev-u1', '[]');
    const result = await authorizeUser(user(), { allowedUsers: allowed(null), sessionStore: createSessionStore(env) });
    expect(result).toEqual({ status: 'denied' });
    expect(store.has('tareas-dev-u1')).toBe(false);
  });

  it('pide verificar el correo y no deja entrar a sesiones anónimas', async () => {
    const sessionStore = createSessionStore(env);
    expect(
      await authorizeUser(user({ emailVerified: false }), { allowedUsers: allowed(member()), sessionStore }),
    ).toEqual({
      status: 'unverified',
    });
    expect(await authorizeUser(user({ isAnonymous: true }), { allowedUsers: allowed(member()), sessionStore })).toEqual(
      {
        status: 'denied',
      },
    );
  });

  it('sin conexión vale la última autorización confirmada', async () => {
    const sessionStore = createSessionStore(env);
    const offline = { find: () => Promise.reject(new RepositoryError('unavailable')) };
    expect(await authorizeUser(user(), { allowedUsers: offline, sessionStore })).toMatchObject({ status: 'offline' });

    sessionStore.remember('u1', 'Ana', 1000);
    expect(await authorizeUser(user(), { allowedUsers: offline, sessionStore, now: 2000 })).toEqual({
      status: 'ok',
      name: 'Ana',
      role: 'member',
      permissions: {},
      offline: true,
    });
  });

  it('SessionStore guarda la hora de la autorización y sigue leyendo el formato anterior', () => {
    const sessionStore = createSessionStore(env);
    sessionStore.remember('u1', 'Ana', 1000);
    expect(JSON.parse(store.get('lucas-autorizado-dev-u1'))).toEqual({ name: 'Ana', at: 1000 });

    store.set('lucas-autorizado-dev-u1', JSON.stringify({ name: 'Ana' }));
    expect(sessionStore.remembered('u1')).toEqual({ name: 'Ana' });
    store.set('lucas-autorizado-dev-u1', '{roto');
    expect(sessionStore.remembered('u1')).toBeNull();
  });

  it('una persona desactivada no entra y se borran sus datos locales', async () => {
    store.set('tareas-dev-u1', '[]');
    store.set('lucas-autorizado-dev-u1', JSON.stringify({ name: 'Ana', at: 1 }));
    const allowedUsers = allowed(member({ active: false }));
    expect(await authorizeUser(user(), { allowedUsers, sessionStore: createSessionStore(env) })).toEqual({
      status: 'inactive',
    });
    expect(store.has('tareas-dev-u1')).toBe(false);
    expect(store.has('lucas-autorizado-dev-u1')).toBe(false);
  });

  it('si las reglas le niegan la lectura, la cuenta no tiene acceso', async () => {
    const denied = { find: () => Promise.reject(new RepositoryError('permission-denied')) };
    expect(await authorizeUser(user(), { allowedUsers: denied, sessionStore: createSessionStore(env) })).toEqual({
      status: 'denied',
    });
  });
});
