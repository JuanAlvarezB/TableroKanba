import { describe, expect, it } from 'vitest';
import { FILTERS, countByStatus, isColumnFull, nextOrder, orderBefore, sortTasks } from './board.js';
import { businessDaysUntil, calendarDaysSince } from './dates.js';
import { dueStatus, needsDueAttention, parseDueDate } from './dueDates.js';
import {
  FEATURES,
  FEATURE_KEYS,
  applyPermissionChange,
  effectivePermissions,
  featureDefaults,
  permissionDiff,
} from './features.js';
import {
  HISTORY_KEEP,
  HISTORY_LIMIT,
  HISTORY_SOFT_LIMIT,
  HISTORY_TEXT_LIMIT,
  deriveHistory,
  effectiveHistory,
  historyEventsFor,
  planHistoryWrite,
  truncateText,
} from './history.js';
import {
  ACCESS_STATES,
  ACTIONS,
  BACKUP_MAX_AGE,
  NAME_MAX_LENGTH,
  accessChanged,
  accessState,
  can,
  canChangeUser,
  isBackupFresh,
  isValidEmail,
  lifecycleOf,
  matchesEmail,
  normalizeEmail,
  validateNewUser,
} from './permissions.js';
import { priorityRank, sortByPriority } from './priority.js';
import { attentionIds, currentReminderSlot } from './reminders.js';
import { stalledDays } from './stalledTasks.js';

// Miércoles 7 de octubre de 2026, 10:30 (hora local).
const WEDNESDAY = new Date(2026, 9, 7, 10, 30);
const FRIDAY = new Date(2026, 9, 9, 18, 0);
const day = (d, h = 9) => new Date(2026, 9, d, h).getTime();

const task = (fields) => ({
  id: 'a',
  text: 'Tarea',
  status: 'pending',
  order: 0,
  createdAt: null,
  startedAt: null,
  completedAt: null,
  priority: null,
  dueDate: null,
  ...fields,
});

describe('calendarDaysSince', () => {
  it('cuenta días calendario de medianoche a medianoche', () => {
    expect(calendarDaysSince(day(7, 23), WEDNESDAY)).toBe(0);
    expect(calendarDaysSince(day(6, 23), WEDNESDAY)).toBe(1);
    expect(calendarDaysSince(day(1), WEDNESDAY)).toBe(6);
    expect(calendarDaysSince(day(10), WEDNESDAY)).toBe(-3);
  });
});

describe('businessDaysUntil', () => {
  it('no cuenta sábados ni domingos', () => {
    // Del viernes al lunes siguiente solo hay un día hábil: el lunes.
    expect(businessDaysUntil(parseDueDate('2026-10-12'), 2, FRIDAY)).toBe(1);
  });

  it('deja de contar al superar el límite', () => {
    expect(businessDaysUntil(parseDueDate('2026-12-31'), 2, WEDNESDAY)).toBe(3);
  });
});

describe('dueStatus', () => {
  it.each([
    ['2026-10-06', 'overdue', -1],
    ['2026-10-07', 'soon', 0],
    ['2026-10-08', 'soon', 1],
    ['2026-10-09', 'soon', 2],
    ['2026-10-12', 'scheduled', 5],
  ])('el miércoles, una tarea que vence el %s está %s', (dueDate, kind, days) => {
    expect(dueStatus(task({ dueDate }), WEDNESDAY)).toMatchObject({ kind, days });
  });

  it('el viernes, una tarea del lunes ya es próxima a vencer (1 día hábil)', () => {
    expect(dueStatus(task({ dueDate: '2026-10-12' }), FRIDAY)).toMatchObject({ kind: 'soon', days: 3 });
  });

  it('no aplica sin fecha ni a tareas completadas', () => {
    expect(dueStatus(task({}), WEDNESDAY)).toBeNull();
    expect(dueStatus(task({ dueDate: '2026-10-01', status: 'completed' }), WEDNESDAY)).toBeNull();
  });

  it('needsDueAttention solo incluye vencidas y próximas a vencer', () => {
    expect(needsDueAttention(task({ dueDate: '2026-10-06' }), WEDNESDAY)).toBe(true);
    expect(needsDueAttention(task({ dueDate: '2026-10-09' }), WEDNESDAY)).toBe(true);
    expect(needsDueAttention(task({ dueDate: '2026-10-12' }), WEDNESDAY)).toBe(false);
    expect(needsDueAttention(task({}), WEDNESDAY)).toBe(false);
  });
});

describe('stalledDays', () => {
  it('marca las tareas con más de 3 días en Pendiente o En curso', () => {
    expect(stalledDays(task({ createdAt: day(3) }), WEDNESDAY)).toBe(4);
    expect(stalledDays(task({ createdAt: day(4) }), WEDNESDAY)).toBeNull();
    expect(stalledDays(task({ status: 'in-progress', createdAt: day(1), startedAt: day(1) }), WEDNESDAY)).toBe(6);
  });

  it('cuenta desde que la tarea entró en su columna actual', () => {
    expect(stalledDays(task({ status: 'in-progress', createdAt: day(1), startedAt: day(6) }), WEDNESDAY)).toBeNull();
  });

  it('ignora las completadas y las que no tienen fecha', () => {
    expect(stalledDays(task({ status: 'completed', completedAt: day(1) }), WEDNESDAY)).toBeNull();
    expect(stalledDays(task({ createdAt: null }), WEDNESDAY)).toBeNull();
  });
});

describe('prioridad', () => {
  it('ordena Urgente, Prioritaria, Puede esperar y sin etiqueta, respetando el orden manual', () => {
    const list = [
      task({ id: '1', priority: null }),
      task({ id: '2', priority: 'low' }),
      task({ id: '3', priority: 'urgent' }),
      task({ id: '4', priority: 'high' }),
      task({ id: '5', priority: 'urgent' }),
    ];
    expect(sortByPriority(list).map((t) => t.id)).toEqual(['3', '5', '4', '2', '1']);
    expect(priorityRank(task({ priority: null }))).toBe(3);
  });
});

describe('tablero', () => {
  it('ordena por "order" y desempata por id', () => {
    const list = [task({ id: 'b', order: 1 }), task({ id: 'c', order: 0 }), task({ id: 'a', order: 1 })];
    expect(sortTasks(list).map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('calcula el orden al final y entre dos tareas', () => {
    const list = [task({ id: 'a', order: 0 }), task({ id: 'b', order: 1 })];
    expect(nextOrder([])).toBe(0);
    expect(nextOrder(list)).toBe(2);
    expect(orderBefore(list, 1)).toBe(0.5);
    expect(orderBefore(list, 0)).toBe(-0.5);
  });

  it('aplica el límite WIP de En curso (200)', () => {
    const inProgress = Array.from({ length: 200 }, (_, i) => task({ id: String(i), status: 'in-progress' }));
    expect(countByStatus(inProgress, 'in-progress')).toBe(200);
    expect(isColumnFull(inProgress, 'in-progress')).toBe(true);
    expect(isColumnFull(inProgress.slice(1), 'in-progress')).toBe(false);
    expect(isColumnFull(inProgress, 'pending')).toBe(false);
  });

  it('los filtros se pueden usar directamente en filter() y every()', () => {
    const list = [task({ id: '1', priority: 'urgent' }), task({ id: '2' })];
    expect(list.filter(FILTERS.urgent).map((t) => t.id)).toEqual(['1']);
    expect(list.filter(FILTERS.none).map((t) => t.id)).toEqual(['2']);
    expect(list.every(FILTERS.all)).toBe(true);
    // filter() pasa el índice como segundo argumento; el filtro de vencimiento debe ignorarlo.
    expect([task({ dueDate: '2000-01-01' })].filter(FILTERS.due)).toHaveLength(1);
  });
});

describe('recordatorios', () => {
  it('turno de la mañana desde las 10:00 y de la tarde desde las 15:00, de lunes a viernes', () => {
    expect(currentReminderSlot(new Date(2026, 9, 7, 9, 59))).toBeNull();
    expect(currentReminderSlot(new Date(2026, 9, 7, 10, 0))).toEqual({ id: '2026-10-7@10', label: 'de la mañana' });
    expect(currentReminderSlot(new Date(2026, 9, 7, 15, 30))).toEqual({ id: '2026-10-7@15', label: 'de la tarde' });
    expect(currentReminderSlot(new Date(2026, 9, 10, 12, 0))).toBeNull(); // sábado
  });

  it('agrupa las tareas que necesitan atención', () => {
    const list = [
      task({ id: 'detenida', createdAt: day(1) }),
      task({ id: 'urgente', createdAt: day(7), priority: 'urgent' }),
      task({ id: 'vencida', createdAt: day(7), dueDate: '2026-10-06' }),
      task({ id: 'pronto', createdAt: day(7), dueDate: '2026-10-08' }),
      task({ id: 'hecha', status: 'completed', completedAt: day(1), priority: 'urgent', dueDate: '2026-10-01' }),
    ];
    expect(attentionIds(list, WEDNESDAY)).toEqual({
      stalled: { pending: ['detenida'], 'in-progress': [] },
      urgent: ['urgente'],
      overdueDue: ['vencida'],
      soonDue: ['pronto'],
    });
  });
});

describe('matriz de permisos', () => {
  // Fila por acción, columnas: administrador, miembro, inactivo, no autorizado (docs/PLAN_USUARIOS.md, 1.6).
  const expected = {
    'tasks.own': [true, true, false, false],
    'tasks.others': [false, false, false, false],
    'users.readOwn': [true, true, true, false],
    'users.claimUid': [true, true, false, false],
    'users.changeOwn': [false, false, false, false],
    'users.readOthers': [true, false, false, false],
    'users.writeOthers': [true, false, false, false],
    'users.delete': [true, false, false, false],
  };

  it('cubre todas las acciones', () => {
    expect(ACTIONS).toEqual(Object.keys(expected));
  });

  it.each(ACTIONS.flatMap((action) => ACCESS_STATES.map((state, i) => [action, state, expected[action][i]])))(
    '%s · %s → %s',
    (action, state, allowed) => {
      expect(can(state, action)).toBe(allowed);
    },
  );

  it('nadie, en ningún estado, toca tareas ajenas', () => {
    expect(ACCESS_STATES.filter((state) => can(state, 'tasks.others'))).toEqual([]);
  });

  it('una acción desconocida se niega', () => {
    expect(can('admin', 'users.todo')).toBe(false);
    expect(can('admin', 'toString')).toBe(false);
  });

  it('el estado sale de la autorización; sin conexión nunca se es administrador', () => {
    expect(accessState({ status: 'ok', role: 'admin', permissions: {} })).toBe('admin');
    expect(accessState({ status: 'ok', role: 'admin', permissions: {}, offline: true })).toBe('member');
    expect(accessState({ status: 'ok', role: 'member', permissions: {} })).toBe('member');
    expect(accessState({ status: 'inactive' })).toBe('inactive');
    expect(accessState({ status: 'denied' })).toBe('unauthorized');
    expect(accessState({ status: 'unverified' })).toBe('unauthorized');
    expect(accessState({ status: 'offline', error: null })).toBe('unauthorized');
  });
});

describe('canChangeUser', () => {
  const person = (email, fields = {}) => ({
    email,
    name: email,
    role: 'member',
    active: true,
    uid: null,
    permissions: {},
    deleting: false,
    ...fields,
  });
  const admin = person('admin@x.com', { role: 'admin' });
  const ana = person('ana@x.com');

  it.each([
    [{ type: 'demote', role: 'member' }],
    [{ type: 'deactivate' }],
    [{ type: 'reactivate' }],
    [{ type: 'delete' }],
  ])('un administrador no se cambia a sí mismo: %j', (change) => {
    expect(canChangeUser(admin, admin, change)).toEqual({ ok: false, reason: 'self' });
  });

  it('un miembro (o un administrador inactivo) no cambia a nadie', () => {
    expect(canChangeUser(ana, admin, { type: 'demote', role: 'member' })).toEqual({ ok: false, reason: 'not-admin' });
    const inactiveAdmin = person('otro@x.com', { role: 'admin', active: false });
    expect(canChangeUser(inactiveAdmin, ana, { type: 'deactivate' })).toEqual({ ok: false, reason: 'not-admin' });
  });

  it('un administrador sí cambia el rol o el estado de otra persona', () => {
    expect(canChangeUser(admin, ana, { type: 'promote', role: 'admin' })).toEqual({ ok: true });
    expect(canChangeUser(admin, ana, { type: 'deactivate' })).toEqual({ ok: true });
    expect(canChangeUser(admin, person('otro@x.com', { role: 'admin' }), { type: 'demote', role: 'member' })).toEqual({
      ok: true,
    });
    expect(canChangeUser(admin, person('b@x.com', { active: false }), { type: 'reactivate' })).toEqual({ ok: true });
  });

  it('rechaza un rol desconocido', () => {
    expect(canChangeUser(admin, ana, { type: 'promote', role: 'root' })).toEqual({ ok: false, reason: 'unknown-role' });
  });

  it.each([['deactivate'], ['reactivate'], ['promote'], ['demote'], ['delete']])(
    'una persona en eliminación no admite %s',
    (type) => {
      const deleting = person('e@x.com', { active: false, deleting: true });
      expect(canChangeUser(admin, deleting, { type })).toEqual({ ok: false, reason: 'in-deletion' });
    },
  );

  it('para eliminar, la persona debe estar desactivada y sin rol de administrador', () => {
    expect(canChangeUser(admin, person('c@x.com', { role: 'admin', active: false }), { type: 'delete' })).toEqual({
      ok: false,
      reason: 'target-is-admin',
    });
    expect(canChangeUser(admin, ana, { type: 'delete' })).toEqual({ ok: false, reason: 'target-active' });
    expect(canChangeUser(admin, person('b@x.com', { active: false }), { type: 'delete' })).toEqual({ ok: true });
  });

  it('cancelar una eliminación no confirmada no exige que la persona siga desactivada ni sea miembro', () => {
    expect(canChangeUser(admin, ana, { type: 'cancel-delete' })).toEqual({ ok: true });
    expect(canChangeUser(admin, person('c@x.com', { role: 'admin' }), { type: 'cancel-delete' })).toEqual({ ok: true });
    expect(canChangeUser(admin, admin, { type: 'cancel-delete' })).toEqual({ ok: false, reason: 'self' });
    const confirmed = person('e@x.com', { active: false, deleting: true });
    expect(canChangeUser(admin, confirmed, { type: 'cancel-delete' })).toEqual({ ok: false, reason: 'in-deletion' });
  });

  it('los permisos por función solo se cambian a otro miembro, activo o no', () => {
    expect(canChangeUser(admin, ana, { type: 'permissions' })).toEqual({ ok: true });
    expect(canChangeUser(admin, person('b@x.com', { active: false }), { type: 'permissions' })).toEqual({ ok: true });
    expect(canChangeUser(admin, admin, { type: 'permissions' })).toEqual({ ok: false, reason: 'self' });
    expect(canChangeUser(admin, person('c@x.com', { role: 'admin' }), { type: 'permissions' })).toEqual({
      ok: false,
      reason: 'target-is-admin',
    });
    expect(canChangeUser(ana, person('b@x.com'), { type: 'permissions' })).toEqual({ ok: false, reason: 'not-admin' });
    const deleting = person('e@x.com', { active: false, deleting: true });
    expect(canChangeUser(admin, deleting, { type: 'permissions' })).toEqual({ ok: false, reason: 'in-deletion' });
  });
});

describe('eliminar a una persona', () => {
  const NOW = 1_800_000_000_000;
  const marker = (backupAt) => ({ key: 'u1', state: 'backup-ready', taskCount: 3, backupAt });

  it('isBackupFresh: el respaldo vale menos de 24 horas', () => {
    expect(isBackupFresh(marker(NOW - 60_000), NOW)).toBe(true);
    expect(isBackupFresh(marker(NOW - BACKUP_MAX_AGE + 1), NOW)).toBe(true);
    expect(isBackupFresh(marker(NOW - BACKUP_MAX_AGE), NOW)).toBe(false);
    expect(isBackupFresh(null, NOW)).toBe(false);
  });

  it('matchesEmail compara el correo escrito sin espacios alrededor ni mayúsculas', () => {
    expect(matchesEmail(' Ana@Ejemplo.TEST ', 'ana@ejemplo.test')).toBe(true);
    expect(matchesEmail('ana@ejemplo.tes', 'ana@ejemplo.test')).toBe(false);
    expect(matchesEmail('', 'ana@ejemplo.test')).toBe(false);
  });
});

describe('lifecycleOf', () => {
  it('activo, inactivo o en eliminación; la marca de eliminación manda', () => {
    expect(lifecycleOf({ active: true, deleting: false })).toBe('active');
    expect(lifecycleOf({ active: false, deleting: false })).toBe('inactive');
    expect(lifecycleOf({ active: true, deleting: true })).toBe('deleting');
  });
});

describe('autorizar un correo', () => {
  it('normalizeEmail recorta y pasa a minúsculas', () => {
    expect(normalizeEmail('  Ana.Perez@Ejemplo.TEST ')).toBe('ana.perez@ejemplo.test');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it.each([
    ['ana@ejemplo.test', true],
    ['a.b+c@sub.ejemplo.test', true],
    ['ana', false],
    ['ana@ejemplo', false],
    ['ana @ejemplo.test', false],
    ['ana@ejemplo/x.test', false],
    ['', false],
  ])('isValidEmail(%j) → %s', (email, ok) => {
    expect(isValidEmail(email)).toBe(ok);
  });

  it('validateNewUser normaliza el correo y el nombre', () => {
    expect(validateNewUser({ email: ' Ana@Ejemplo.TEST', name: '  Ana  ', role: 'member' })).toEqual({
      ok: true,
      value: { email: 'ana@ejemplo.test', name: 'Ana', role: 'member' },
    });
  });

  it.each([
    [{ email: 'ana', name: 'Ana', role: 'member' }, 'invalid-email'],
    [{ email: 'ana@ejemplo.test', name: '   ', role: 'member' }, 'missing-name'],
    [{ email: 'ana@ejemplo.test', name: 'a'.repeat(NAME_MAX_LENGTH + 1), role: 'member' }, 'name-too-long'],
    [{ email: 'ana@ejemplo.test', name: 'Ana', role: 'root' }, 'unknown-role'],
  ])('validateNewUser rechaza %j: %s', (input, reason) => {
    expect(validateNewUser(input)).toEqual({ ok: false, reason });
  });

  it('acepta un nombre de exactamente 100 caracteres', () => {
    expect(validateNewUser({ email: 'a@b.co', name: 'a'.repeat(NAME_MAX_LENGTH), role: 'admin' }).ok).toBe(true);
  });
});

describe('accessChanged', () => {
  it('detecta un cambio de rol o de permisos, sin importar el orden de las claves', () => {
    const before = { role: 'member', permissions: { a: true, b: false } };
    expect(accessChanged(before, { role: 'member', permissions: { b: false, a: true } })).toBe(false);
    expect(accessChanged(before, { role: 'admin', permissions: { a: true, b: false } })).toBe(true);
    expect(accessChanged(before, { role: 'member', permissions: { a: false, b: false } })).toBe(true);
  });
});

describe('permisos por función: catálogo', () => {
  it('el tablero es el padre de cinco hijas', () => {
    expect(FEATURE_KEYS).toEqual(['board', 'priorities', 'dueDates', 'stalledAlerts', 'reminders', 'history']);
    expect(FEATURES.filter(({ parent }) => parent === null).map(({ key }) => key)).toEqual(['board']);
    expect(FEATURES.filter(({ parent }) => parent === 'board')).toHaveLength(5);
  });

  it('las reglas de Firestore cumplen board, priorities y dueDates, y su valor inicial es true (A-37)', () => {
    const enforced = FEATURES.filter(({ enforcedInRules }) => enforcedInRules);
    expect(enforced.map(({ key }) => key)).toEqual(['board', 'priorities', 'dueDates']);
    enforced.forEach(({ defaultValue }) => expect(defaultValue).toBe(true));
  });

  it('featureDefaults toma el catálogo y solo los ajustes booleanos de funciones conocidas', () => {
    expect(featureDefaults()).toEqual({
      board: true,
      priorities: true,
      dueDates: true,
      stalledAlerts: true,
      reminders: true,
      history: true,
    });
    expect(featureDefaults({ reminders: false, history: 'no', otra: false })).toEqual({
      ...featureDefaults(),
      reminders: false,
    });
  });
});

describe('permisos por función: effectivePermissions', () => {
  const member = (permissions = {}) => ({ role: 'member', permissions });
  const all = (value) => Object.fromEntries(FEATURE_KEYS.map((key) => [key, value]));

  it('un documento sin permisos tiene todas las funciones con su valor inicial', () => {
    expect(effectivePermissions(member())).toEqual(all(true));
    const defaults = featureDefaults({ reminders: false });
    expect(effectivePermissions(member(), defaults)).toEqual({ ...all(true), reminders: false });
  });

  it('el valor guardado manda sobre el inicial', () => {
    expect(effectivePermissions(member({ priorities: false }))).toEqual({ ...all(true), priorities: false });
    const defaults = featureDefaults({ reminders: false });
    expect(effectivePermissions(member({ reminders: true }), defaults)).toEqual(all(true));
  });

  it('apagar el padre apaga las hijas, aunque estén encendidas', () => {
    expect(effectivePermissions(member({ board: false, priorities: true, history: true }))).toEqual(all(false));
  });

  it.each([['false'], [0], [1], ['true'], [null], [{}]])('un valor corrupto (%j) apaga la función', (value) => {
    expect(effectivePermissions(member({ dueDates: value })).dueDates).toBe(false);
    expect(effectivePermissions(member({ board: value }))).toEqual(all(false));
  });

  it('un administrador tiene todas las funciones, aunque las tenga apagadas', () => {
    expect(effectivePermissions({ role: 'admin', permissions: all(false) })).toEqual(all(true));
    expect(effectivePermissions({ role: 'admin', permissions: {} }, featureDefaults({ history: false }))).toEqual(
      all(true),
    );
  });
});

describe('permisos por función: applyPermissionChange', () => {
  it('apagar y volver a encender el padre conserva las hijas', () => {
    const stored = { board: true, priorities: false, history: true };
    const off = applyPermissionChange(stored, 'board', false);
    expect(off).toEqual({ board: false, priorities: false, history: true });
    expect(applyPermissionChange(off, 'board', true)).toEqual(stored);
  });

  it('cambia solo la clave indicada y no modifica el mapa recibido', () => {
    const stored = { dueDates: false };
    expect(applyPermissionChange(stored, 'reminders', false)).toEqual({ dueDates: false, reminders: false });
    expect(stored).toEqual({ dueDates: false });
  });

  it('quita claves desconocidas y pasa a false los valores corruptos', () => {
    expect(applyPermissionChange({ tablero: true, history: 'false', dueDates: true }, 'board', false)).toEqual({
      dueDates: true,
      history: false,
      board: false,
    });
  });
});

describe('permisos por función: permissionDiff', () => {
  it('lista lo que se apaga y lo que se enciende, en el orden del catálogo', () => {
    expect(permissionDiff({ history: false }, { board: false, history: true })).toEqual({
      off: ['board'],
      on: ['history'],
    });
    expect(permissionDiff({}, { dueDates: false, priorities: false })).toEqual({ off: ['priorities', 'dueDates'] });
  });

  it('una clave ausente vale su valor inicial: guardarlo explícito no es un cambio', () => {
    expect(permissionDiff({}, { board: true })).toEqual({});
    expect(permissionDiff({ board: true }, {})).toEqual({});
    expect(permissionDiff({}, { reminders: false }, featureDefaults({ reminders: false }))).toEqual({});
  });

  it('un valor corrupto cuenta como apagado', () => {
    expect(permissionDiff({ board: 'true' }, { board: false })).toEqual({});
    expect(permissionDiff({ board: 'true' }, { board: true })).toEqual({ on: ['board'] });
  });

  it('cambiar las seis funciones cabe en dos claves', () => {
    const off = Object.fromEntries(FEATURE_KEYS.map((key) => [key, false]));
    expect(permissionDiff({}, off)).toEqual({ off: FEATURE_KEYS });
    expect(Object.keys(permissionDiff({}, off))).toHaveLength(1);
  });
});

describe('historial: truncateText', () => {
  it('deja igual un texto de 200 caracteres o menos', () => {
    expect(truncateText('Hola')).toBe('Hola');
    expect(truncateText('a'.repeat(200))).toBe('a'.repeat(200));
  });

  it('recorta a 200 caracteres con … al final, sin partir un emoji', () => {
    expect(truncateText('a'.repeat(201))).toBe('a'.repeat(199) + '…');
    const clipped = truncateText('a'.repeat(198) + '😀😀😀');
    expect(clipped).toBe('a'.repeat(198) + '😀…');
    expect(Array.from(clipped)).toHaveLength(HISTORY_TEXT_LIMIT);
  });
});

describe('historial: historyEventsFor', () => {
  const AT = 1_790_000_000_000;
  let count;
  const clock = () => {
    count = 0;
    return { now: AT, newId: () => `h${++count}` };
  };
  const before = task({ id: 'a', text: 'Antes', createdAt: 1 });

  it('al crear genera create con el texto recortado', () => {
    expect(historyEventsFor(null, { text: 'Nueva' }, clock())).toEqual([
      { id: 'h1', type: 'create', at: AT, text: 'Nueva' },
    ]);
    expect(historyEventsFor(null, { text: 'x'.repeat(300) }, clock())[0].text).toHaveLength(HISTORY_TEXT_LIMIT);
  });

  it('edit guarda el texto anterior y el nuevo, recortados', () => {
    expect(historyEventsFor(before, { text: 'Después' }, clock())).toEqual([
      { id: 'h1', type: 'edit', at: AT, from: 'Antes', to: 'Después' },
    ]);
    const [event] = historyEventsFor(before, { text: 'y'.repeat(500) }, clock());
    expect(event.to).toBe('y'.repeat(199) + '…');
  });

  it('move al cambiar de columna; las fechas y el orden no generan eventos', () => {
    expect(
      historyEventsFor(before, { status: 'in-progress', order: 4, startedAt: AT, completedAt: null }, clock()),
    ).toEqual([{ id: 'h1', type: 'move', at: AT, from: 'pending', to: 'in-progress' }]);
  });

  it('reordenar dentro de la misma columna no genera eventos', () => {
    expect(historyEventsFor(before, { status: 'pending', order: 7 }, clock())).toEqual([]);
  });

  it('priority al poner, cambiar o quitar la etiqueta', () => {
    expect(historyEventsFor(before, { priority: 'urgent', order: 3 }, clock())).toEqual([
      { id: 'h1', type: 'priority', at: AT, from: null, to: 'urgent' },
    ]);
    const urgent = { ...before, priority: 'urgent' };
    expect(historyEventsFor(urgent, { priority: 'low' }, clock())[0]).toMatchObject({ from: 'urgent', to: 'low' });
    expect(historyEventsFor(urgent, { priority: null }, clock())[0]).toMatchObject({ from: 'urgent', to: null });
  });

  it('due al poner, cambiar o quitar la fecha límite', () => {
    expect(historyEventsFor(before, { dueDate: '2026-10-15' }, clock())).toEqual([
      { id: 'h1', type: 'due', at: AT, from: null, to: '2026-10-15' },
    ]);
    const due = { ...before, dueDate: '2026-10-15' };
    expect(historyEventsFor(due, { dueDate: '2026-10-20' }, clock())[0]).toMatchObject({
      from: '2026-10-15',
      to: '2026-10-20',
    });
    expect(historyEventsFor(due, { dueDate: null }, clock())[0]).toMatchObject({ from: '2026-10-15', to: null });
  });

  it('un cambio sin diferencias no genera eventos', () => {
    expect(historyEventsFor(before, {}, clock())).toEqual([]);
    expect(historyEventsFor(before, { text: 'Antes', priority: null, dueDate: null }, clock())).toEqual([]);
  });

  it('ningún evento lleva datos de la persona', () => {
    const owned = { ...before, ownerId: 'uid-ana', email: 'ana@example.com', name: 'Ana' };
    const events = [
      ...historyEventsFor(null, { text: 'Nueva', ownerId: 'uid-ana' }, clock()),
      ...historyEventsFor(
        owned,
        { text: 'Otra', status: 'completed', priority: 'high', dueDate: '2026-10-15', ownerId: 'uid-beto' },
        clock(),
      ),
      ...deriveHistory(task({ status: 'completed', createdAt: 1, startedAt: 2, completedAt: 3 })),
    ];
    expect(events.map((event) => event.type)).toEqual([
      'create',
      'edit',
      'move',
      'priority',
      'due',
      'move',
      'move',
      'move',
    ]);
    const allowed = ['id', 'type', 'at', 'text', 'from', 'to', 'derived'];
    events.forEach((event) => expect(Object.keys(event).filter((key) => !allowed.includes(key))).toEqual([]));
    expect(JSON.stringify(events)).not.toMatch(/uid-|example\.com|Ana/);
  });
});

describe('historial: deriveHistory (tareas anteriores al historial)', () => {
  const move = (from, to, at) => ({ id: `d:${to}:${at}`, type: 'move', at, from, to, derived: true });

  it('en Pendiente sin fecha de En curso: un move a Pendiente', () => {
    expect(deriveHistory(task({ createdAt: 10 }))).toEqual([move(null, 'pending', 10)]);
  });

  it('devuelta a Pendiente: empieza por En curso y vuelve a Pendiente', () => {
    expect(deriveHistory(task({ createdAt: 30, startedAt: 20 }))).toEqual([
      move(null, 'in-progress', 20),
      move('in-progress', 'pending', 30),
    ]);
  });

  it('en curso: Pendiente y luego En curso', () => {
    expect(deriveHistory(task({ status: 'in-progress', createdAt: 10, startedAt: 20 }))).toEqual([
      move(null, 'pending', 10),
      move('pending', 'in-progress', 20),
    ]);
  });

  it('completada: los anteriores que existan y luego Completada', () => {
    expect(deriveHistory(task({ status: 'completed', createdAt: 10, startedAt: 20, completedAt: 30 }))).toEqual([
      move(null, 'pending', 10),
      move('pending', 'in-progress', 20),
      move('in-progress', 'completed', 30),
    ]);
    expect(deriveHistory(task({ status: 'completed', createdAt: 10, completedAt: 30 }))).toEqual([
      move(null, 'pending', 10),
      move('pending', 'completed', 30),
    ]);
    // Estuvo en curso, volvió a Pendiente y se completó desde allí.
    expect(deriveHistory(task({ status: 'completed', createdAt: 25, startedAt: 20, completedAt: 30 }))).toEqual([
      move(null, 'in-progress', 20),
      move('in-progress', 'pending', 25),
      move('pending', 'completed', 30),
    ]);
  });

  it('omite las fechas ausentes', () => {
    expect(deriveHistory(task({ status: 'in-progress', startedAt: 20 }))).toEqual([move(null, 'in-progress', 20)]);
    expect(deriveHistory(task({ status: 'completed', completedAt: 30 }))).toEqual([move(null, 'completed', 30)]);
    expect(deriveHistory(task())).toEqual([]);
  });

  it('nunca genera create y sus identificadores son deterministas', () => {
    const old = task({ status: 'completed', createdAt: 10, startedAt: 20, completedAt: 30 });
    expect(deriveHistory(old)).toEqual(deriveHistory({ ...old }));
    expect(deriveHistory(old).map((event) => event.id)).toEqual(['d:pending:10', 'd:in-progress:20', 'd:completed:30']);
    expect(deriveHistory(old).some((event) => event.type === 'create')).toBe(false);
  });
});

describe('historial: effectiveHistory y planHistoryWrite', () => {
  const AT = 1_790_000_000_000;
  const event = (id) => ({ id, type: 'edit', at: AT, from: 'a', to: 'b' });
  const events = (n) => Array.from({ length: n }, (_, i) => event(`e${i}`));
  const old = task({ createdAt: 10 });

  it('effectiveHistory usa el guardado y, si no hay, el derivado', () => {
    expect(effectiveHistory({ ...old, history: [event('e1')] })).toEqual([event('e1')]);
    expect(effectiveHistory({ ...old, history: [] })).toEqual([]);
    expect(effectiveHistory({ ...old, history: null })).toEqual(deriveHistory(old));
  });

  it('sin eventos no hay nada que escribir', () => {
    expect(planHistoryWrite({ ...old, history: [] }, [])).toBeNull();
    expect(planHistoryWrite({ ...old, history: null }, [])).toBeNull();
  });

  it('sin history guardado, materializa los derivados en la misma escritura', () => {
    expect(planHistoryWrite({ ...old, history: null }, [event('n')])).toEqual({
      mode: 'append',
      events: [...deriveHistory(old), event('n')],
    });
  });

  it('con history guardado por debajo del tope blando, solo añade', () => {
    expect(planHistoryWrite({ ...old, history: events(HISTORY_SOFT_LIMIT - 1) }, [event('n')])).toEqual({
      mode: 'append',
      events: [event('n')],
    });
  });

  it('desde el tope blando, compacta a los 60 más recientes más los nuevos', () => {
    const history = events(HISTORY_SOFT_LIMIT);
    const plan = planHistoryWrite({ ...old, history }, [event('n1'), event('n2')]);
    expect(plan.mode).toBe('replace');
    expect(plan.history).toHaveLength(HISTORY_KEEP + 2);
    expect(plan.history[0]).toEqual(history[HISTORY_SOFT_LIMIT - HISTORY_KEEP]);
    expect(plan.history.slice(-2)).toEqual([event('n1'), event('n2')]);
    expect(planHistoryWrite({ ...old, history: events(HISTORY_LIMIT) }, [event('n')]).history).toHaveLength(61);
  });
});
