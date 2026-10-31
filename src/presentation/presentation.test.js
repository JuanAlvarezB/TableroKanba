import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStore } from '../data/repositories/SessionStore.js';
import { RepositoryError } from '../domain/repositories/RepositoryError.js';
import { ALL_FEATURES } from '../domain/rules/features.js';
import { authorizeUser } from '../domain/usecases/AuthorizeUser.js';
import { deriveHistory } from '../domain/rules/history.js';
import { applyFeatureVisibility, isVisibleFor, showFeatureNotice } from './components/FeatureVisibility.js';
import { labelMenuName } from './components/LabelMenu.js';
import { currentFeatures, setFeatures } from './state/features.js';
import { newestFirst, stepLabel } from './components/TaskHistory.js';
import { backupCommand, cleanupCommand } from './components/DeleteWizard.js';
import { changeSummary, panelItems, pendingChanges } from './components/PermissionsPanel.js';
import { actionLabel, actionsFor, deletionNote, displayedName } from './components/UserList.js';
import { dueInfo, formatDate, historyEventText } from './format/dates.js';
import { CLIP_LENGTH, HISTORY_TEXTS, clipText, plural } from './format/labels.js';
import { FEATURE_MESSAGES } from '../shared/constants/messages.js';

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
  const event = (fields) => ({ id: 'abcd1234', at: WEDNESDAY.getTime(), ...fields });

  it.each([
    [{ type: 'create', text: 'Revisar el informe' }, 'Creada: «Revisar el informe»'],
    [{ type: 'edit', from: 'Revisar', to: 'Revisar el informe' }, 'Texto: «Revisar» → «Revisar el informe»'],
    [{ type: 'move', from: 'pending', to: 'in-progress' }, 'Movida de Pendiente a En curso'],
    [{ type: 'move', from: 'in-progress', to: 'completed' }, 'Movida de En curso a Completada'],
    [{ type: 'move', from: null, to: 'pending' }, 'Entró en Pendiente'],
    [{ type: 'priority', from: null, to: 'urgent' }, 'Prioridad: sin etiqueta → Urgente'],
    [{ type: 'priority', from: 'high', to: null }, 'Prioridad: Prioritaria → sin etiqueta'],
    [{ type: 'due', from: null, to: '2026-10-15' }, 'Fecha límite: sin fecha → 15 oct 2026'],
    [{ type: 'due', from: '2026-10-15', to: null }, 'Fecha límite: 15 oct 2026 → sin fecha'],
    [{ type: 'subtask', text: 'Revisar cifras', to: 'done' }, 'Subtarea terminada: «Revisar cifras»'],
    [{ type: 'subtask', text: 'Revisar cifras', to: 'pending' }, 'Subtarea pendiente otra vez: «Revisar cifras»'],
  ])('%o → %s', (fields, text) => {
    expect(historyEventText(event(fields))).toBe(text);
  });

  it('el control cuenta los eventos', () => {
    expect(HISTORY_TEXTS.toggle(3)).toBe('Ver historial (3)');
    expect(HISTORY_TEXTS.derived).toBe('(según las fechas guardadas)');
  });

  it('del más reciente al más antiguo; con la misma hora, primero el último añadido', () => {
    const events = [
      { id: 'a', at: 1 },
      { id: 'b', at: 3 },
      { id: 'c', at: 3 },
      { id: 'd', at: 2 },
    ];
    expect(newestFirst(events).map((e) => e.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('una tarea existente muestra su historial derivado de las fechas, del más reciente al más antiguo', () => {
    const task = { status: 'in-progress', createdAt: 1000, startedAt: 2000, completedAt: null, history: null };
    expect(newestFirst(deriveHistory(task)).map(historyEventText)).toEqual([
      'Movida de Pendiente a En curso',
      'Entró en Pendiente',
    ]);
  });

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
      index: 'lucas-indice-dev-u1',
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
      features: ALL_FEATURES,
    });
    expect(allowedUsers.find).toHaveBeenCalledWith('ana@x.com');
    expect(sessionStore.remembered('u1')).toEqual({ name: 'Ana', at: 1000, features: ALL_FEATURES });
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

    sessionStore.remember('u1', 'Ana', 1000, { ...ALL_FEATURES, history: false });
    expect(await authorizeUser(user(), { allowedUsers: offline, sessionStore, now: 2000 })).toEqual({
      status: 'ok',
      name: 'Ana',
      role: 'member',
      permissions: {},
      features: { ...ALL_FEATURES, history: false },
      offline: true,
    });
  });

  it('un administrador sin conexión entra como miembro con sus permisos efectivos, sin rol recordado', async () => {
    const sessionStore = createSessionStore(env);
    const admin = allowed(member({ role: 'admin', permissions: { board: false } }));
    await authorizeUser(user(), { allowedUsers: admin, sessionStore, now: 1000 });
    expect(JSON.parse(store.get('lucas-autorizado-dev-u1'))).toEqual({ name: 'Ana', at: 1000, features: ALL_FEATURES });

    const offline = { find: () => Promise.reject(new RepositoryError('unavailable')) };
    expect(await authorizeUser(user(), { allowedUsers: offline, sessionStore, now: 2000 })).toMatchObject({
      role: 'member',
      features: ALL_FEATURES,
    });
  });

  it('SessionStore guarda la hora y los permisos de la autorización y sigue leyendo el formato anterior', () => {
    const sessionStore = createSessionStore(env);
    sessionStore.remember('u1', 'Ana', 1000, ALL_FEATURES);
    expect(JSON.parse(store.get('lucas-autorizado-dev-u1'))).toEqual({ name: 'Ana', at: 1000, features: ALL_FEATURES });

    store.set('lucas-autorizado-dev-u1', JSON.stringify({ name: 'Ana', at: 1000 }));
    expect(sessionStore.remembered('u1')).toEqual({ name: 'Ana', at: 1000 });

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

describe('acciones de cada fila de la página de usuarios', () => {
  const row = (fields, lifecycle = 'active', self = false, deletion = {}) => ({
    user: {
      email: 'a@x.com',
      name: 'A',
      role: 'member',
      active: true,
      uid: 'u',
      permissions: {},
      deleting: false,
      doneLogId: null,
      ...fields,
    },
    lifecycle,
    self,
    marker: null,
    backupReady: false,
    ...deletion,
  });
  const ready = { key: 'u', state: 'backup-ready', taskCount: 21, backupAt: new Date(2026, 9, 30, 9, 12).getTime() };

  it('la fila propia no tiene acciones; la de una persona en eliminación solo puede reanudarse', () => {
    expect(actionsFor(row({ role: 'admin' }, 'active', true))).toEqual([]);
    expect(actionsFor(row({ active: false, deleting: true }, 'deleting'))).toEqual(['resume']);
  });

  it('activos: permisos, dar o quitar el rol y desactivar', () => {
    expect(actionsFor(row({}))).toEqual(['permissions', 'promote', 'deactivate']);
    expect(actionsFor(row({ role: 'admin' }))).toEqual(['permissions', 'demote', 'deactivate']);
    expect(actionLabel('permissions', row({}))).toBe('Permisos…');
  });

  it('inactivos: permisos, reactivar, eliminar si es miembro y, si es administrador, quitarle el rol', () => {
    expect(actionsFor(row({ active: false }, 'inactive'))).toEqual(['permissions', 'reactivate', 'delete']);
    expect(actionsFor(row({ active: false, role: 'admin' }, 'inactive'))).toEqual([
      'permissions',
      'reactivate',
      'demote',
    ]);
  });

  it('con un respaldo preparado se puede cancelar la eliminación, y eliminar es definitivo', () => {
    const prepared = row({ active: false }, 'inactive', false, { marker: ready, backupReady: true });
    expect(actionsFor(prepared)).toEqual(['permissions', 'reactivate', 'cancel-delete', 'delete']);
    expect(actionLabel('delete', prepared)).toBe('Eliminar definitivamente…');
    expect(actionLabel('delete', row({ active: false }, 'inactive'))).toBe('Eliminar…');
    // Si la persona se reactivó tras el respaldo, el marcador sobrante también se puede cancelar.
    expect(actionsFor(row({}, 'active', false, { marker: ready }))).toEqual([
      'permissions',
      'promote',
      'deactivate',
      'cancel-delete',
    ]);
  });

  it('la nota de la fila muestra el respaldo (número de tareas y fecha), si venció o si quedó sin terminar', () => {
    expect(deletionNote(row({ active: false }, 'inactive'))).toBeNull();
    expect(deletionNote(row({ active: false }, 'inactive', false, { marker: ready, backupReady: true }))).toMatch(
      /^Respaldo listo: 21 tareas, 30 oct/,
    );
    expect(deletionNote(row({ active: false }, 'inactive', false, { marker: ready }))).toBe(
      'Respaldo de más de 24 horas',
    );
    expect(deletionNote(row({ deleting: true }, 'deleting'))).toBe('Eliminación sin terminar');
  });

  it('los comandos del script llevan el ambiente, el correo de quien administra y nunca un uid real', () => {
    expect(backupCommand({ ambiente: 'dev', admin: 'yo@x.com', email: 'a@x.com' })).toBe(
      'npm run admin -- respaldar --ambiente dev --admin yo@x.com --correo a@x.com --aplicar',
    );
    expect(cleanupCommand({ ambiente: 'pdn', admin: 'yo@x.com' })).toBe(
      'npm run admin -- limpiar-usuario --ambiente pdn --admin yo@x.com --uid <su uid> --aplicar',
    );
  });

  it('sin nombre se muestra el correo', () => {
    expect(displayedName({ name: '', email: 'a@x.com' })).toBe('a@x.com');
  });
});

describe('panel de permisos', () => {
  const member = { role: 'member' };
  const withOff = (...keys) => ({ ...ALL_FEATURES, ...Object.fromEntries(keys.map((key) => [key, false])) });
  const itemOf = (items, key) => items.find((item) => item.key === key);

  it('muestra el valor propio de cada función y dónde se cumple', () => {
    const items = panelItems(member, withOff('reminders'), withOff('reminders'));
    expect(items.map(({ key }) => key)).toEqual([
      'board',
      'priorities',
      'dueDates',
      'stalledAlerts',
      'reminders',
      'history',
    ]);
    expect(itemOf(items, 'reminders')).toMatchObject({ checked: false, disabled: false, changed: false, child: true });
    expect(items.filter(({ server }) => server).map(({ key }) => key)).toEqual(['board', 'priorities', 'dueDates']);
  });

  it('con el tablero apagado las hijas se deshabilitan y conservan su valor', () => {
    const saved = withOff('history');
    const items = panelItems(member, saved, withOff('board', 'history'));
    expect(itemOf(items, 'board')).toMatchObject({ checked: false, disabled: false, changed: true });
    expect(itemOf(items, 'priorities')).toMatchObject({ checked: true, disabled: true, changed: false });
    expect(itemOf(items, 'history')).toMatchObject({ checked: false, disabled: true, changed: false });
  });

  it('el panel de un administrador es de solo lectura, con todo activo', () => {
    const stored = withOff('board');
    const items = panelItems({ role: 'admin' }, stored, stored);
    expect(items.every(({ checked, disabled, changed }) => checked && disabled && !changed)).toBe(true);
  });

  it('solo se envían y resumen las funciones que cambian, en el orden del catálogo', () => {
    const saved = withOff('history');
    const draft = withOff('board', 'priorities');
    expect(pendingChanges(saved, draft)).toEqual({ board: false, priorities: false, history: true });
    expect(changeSummary(saved, draft)).toEqual([
      'Tablero de tareas: activada → apagada',
      'Etiquetas de prioridad: activada → apagada',
      'Historial de la tarea: apagada → activada',
    ]);
    expect(pendingChanges(saved, { ...saved })).toEqual({});
  });
});

describe('FeatureVisibility', () => {
  const member = (features = {}) => ({ role: 'member', features: { ...ALL_FEATURES, ...features } });
  const admin = { role: 'admin', features: ALL_FEATURES };

  // DOM de prueba: elementos con dataset y hidden, y un contenedor que los busca por selector.
  function fakeElement(dataset = {}, hidden = false) {
    return { dataset, hidden, textContent: '' };
  }
  function fakeRoot(elements, empty = null) {
    const gated = () => elements.filter((el) => 'feature' in el.dataset || 'role' in el.dataset);
    const container = { querySelectorAll: () => gated() };
    if (empty) empty.parentElement = container;
    return { querySelectorAll: () => gated(), querySelector: () => empty };
  }

  it('un elemento sin marcas siempre se ve', () => {
    expect(isVisibleFor({}, member({ board: false }))).toBe(true);
  });

  it('data-feature se ve solo con la función habilitada', () => {
    expect(isVisibleFor({ feature: 'board' }, member())).toBe(true);
    expect(isVisibleFor({ feature: 'board' }, member({ board: false }))).toBe(false);
    expect(isVisibleFor({ feature: 'priorities' }, member({ priorities: false }))).toBe(false);
    expect(isVisibleFor({ feature: 'desconocida' }, admin)).toBe(false);
  });

  it('data-role="admin" se ve solo con ese rol', () => {
    expect(isVisibleFor({ role: 'admin' }, admin)).toBe(true);
    expect(isVisibleFor({ role: 'admin' }, member())).toBe(false);
  });

  it('oculta y muestra los elementos marcados según la sesión', () => {
    const board = fakeElement({ feature: 'board' }, true);
    const users = fakeElement({ role: 'admin' }, true);
    const plain = fakeElement();
    applyFeatureVisibility(fakeRoot([board, users, plain]), member());
    expect([board.hidden, users.hidden, plain.hidden]).toEqual([false, true, false]);

    applyFeatureVisibility(fakeRoot([board, users, plain]), admin);
    expect([board.hidden, users.hidden]).toEqual([false, false]);
  });

  it('sin ninguna función visible, el lanzador muestra el aviso', () => {
    const board = fakeElement({ feature: 'board' });
    const users = fakeElement({ role: 'admin' }, true);
    const empty = fakeElement({}, true);
    applyFeatureVisibility(fakeRoot([board, users], empty), member({ board: false }));
    expect(board.hidden).toBe(true);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe(FEATURE_MESSAGES.none);
    expect(empty.textContent).toBe('No tienes funciones habilitadas. Habla con el administrador.');
  });

  it('con alguna función visible, el aviso de "sin funciones" queda oculto', () => {
    const empty = fakeElement({}, true);
    applyFeatureVisibility(fakeRoot([fakeElement({ feature: 'board' }, true)], empty), member());
    expect(empty.hidden).toBe(true);
    expect(empty.textContent).toBe('');
  });

  it('muestra el aviso de la función deshabilitada solo si lo hay', () => {
    const notice = fakeElement({}, true);
    showFeatureNotice(notice, null);
    expect(notice.hidden).toBe(true);
    showFeatureNotice(notice, FEATURE_MESSAGES.disabled.board);
    expect(notice).toMatchObject({ hidden: false, textContent: FEATURE_MESSAGES.disabled.board });
    expect(FEATURE_MESSAGES.disabled.board).toBe(
      'El tablero de tareas no está habilitado para tu cuenta. Habla con el administrador.',
    );
  });
});

describe('proveedor de permisos del tablero', () => {
  afterEach(() => setFeatures({}));

  it('sin inicializar no hay ninguna función habilitada', () => {
    expect(Object.values(currentFeatures()).every((value) => value === false)).toBe(true);
  });

  it('guarda solo las funciones del catálogo, solo true las enciende y no se puede cambiar', () => {
    setFeatures({ ...ALL_FEATURES, history: 'true', otra: true });
    expect(currentFeatures()).toEqual({ ...ALL_FEATURES, history: false });
    expect(Object.isFrozen(currentFeatures())).toBe(true);
  });
});

describe('menú de etiquetas con permisos', () => {
  it('su nombre sigue las secciones activas; sin ninguna, no hay botón', () => {
    expect(labelMenuName(ALL_FEATURES)).toBe('Etiqueta y fecha límite');
    expect(labelMenuName({ ...ALL_FEATURES, dueDates: false })).toBe('Etiqueta de prioridad');
    expect(labelMenuName({ ...ALL_FEATURES, priorities: false })).toBe('Fecha límite');
    expect(labelMenuName({ ...ALL_FEATURES, priorities: false, dueDates: false })).toBeNull();
  });
});

describe('recorte del texto de una tarea en los diálogos (clipText)', () => {
  it('deja igual un texto corto o de 80 caracteres', () => {
    expect(clipText('Comprar pan')).toBe('Comprar pan');
    expect(clipText('a'.repeat(CLIP_LENGTH))).toBe('a'.repeat(CLIP_LENGTH));
  });

  it('recorta a 80 caracteres con … al final', () => {
    const clipped = clipText('b'.repeat(120));
    expect(Array.from(clipped)).toHaveLength(CLIP_LENGTH);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('cuenta los emojis como un carácter y no los parte', () => {
    const clipped = clipText('🌻'.repeat(100));
    expect(clipped).toBe('🌻'.repeat(CLIP_LENGTH - 1) + '…');
  });
});
