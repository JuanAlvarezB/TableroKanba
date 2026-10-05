import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStore } from '../data/repositories/SessionStore.js';
import { RepositoryError } from '../domain/repositories/RepositoryError.js';
import { authorizeUser } from '../domain/usecases/AuthorizeUser.js';
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
  const allowed = (result) => ({ find: vi.fn(async () => result) });

  it('usa claves con el ambiente y el uid', () => {
    expect(createSessionStore(env).keysFor('u1')).toEqual({
      tasks: 'tareas-dev-u1',
      migrated: 'tareas-migradas-dev-u1',
      authorized: 'lucas-autorizado-dev-u1',
    });
  });

  it('autoriza, recuerda el nombre y borra las copias del tablero anónimo', async () => {
    store.set('tareas-dev', '[]');
    const allowedUsers = allowed({ name: 'Ana' });
    const sessionStore = createSessionStore(env);
    expect(await authorizeUser(user(), { allowedUsers, sessionStore })).toEqual({ status: 'ok', name: 'Ana' });
    expect(allowedUsers.find).toHaveBeenCalledWith('ana@x.com');
    expect(sessionStore.remembered('u1')).toEqual({ name: 'Ana' });
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
      await authorizeUser(user({ emailVerified: false }), { allowedUsers: allowed({ name: '' }), sessionStore }),
    ).toEqual({
      status: 'unverified',
    });
    expect(
      await authorizeUser(user({ isAnonymous: true }), { allowedUsers: allowed({ name: '' }), sessionStore }),
    ).toEqual({
      status: 'denied',
    });
  });

  it('sin conexión vale la última autorización confirmada', async () => {
    const sessionStore = createSessionStore(env);
    const offline = { find: () => Promise.reject(new RepositoryError('unavailable')) };
    expect(await authorizeUser(user(), { allowedUsers: offline, sessionStore })).toMatchObject({ status: 'offline' });

    sessionStore.remember('u1', 'Ana');
    expect(await authorizeUser(user(), { allowedUsers: offline, sessionStore })).toEqual({
      status: 'ok',
      name: 'Ana',
      offline: true,
    });
  });

  it('si las reglas le niegan la lectura, la cuenta no tiene acceso', async () => {
    const denied = { find: () => Promise.reject(new RepositoryError('permission-denied')) };
    expect(await authorizeUser(user(), { allowedUsers: denied, sessionStore: createSessionStore(env) })).toEqual({
      status: 'denied',
    });
  });
});
