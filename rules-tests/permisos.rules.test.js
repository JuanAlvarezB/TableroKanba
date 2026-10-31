// Permisos por función en firestore.rules (docs/PLAN_USUARIOS.md, 3.4 y 3.8, casos Q-1…Q-11): el tablero
// (padre) controla el acceso del dueño a tasks y taskIndex, priorities y dueDates bloquean la escritura de su
// campo, y solo un administrador cambia los permisos de otra persona, con su entrada set-permissions. Las
// invariantes de siempre: el administrador no lee tareas ajenas y nadie cambia sus propios permisos.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdminUsersRepository } from '../src/data/repositories/AdminUsersRepository.js';
import { userFromData } from '../src/domain/entities/User.js';
import { FEATURES, FEATURE_KEYS, effectivePermissions } from '../src/domain/rules/features.js';
import { setUserPermissions } from '../src/domain/usecases/admin/SetUserPermissions.js';
import {
  ANA,
  BETO,
  createTestEnvironment,
  indexedTask,
  readRules,
  removeTask,
  saveTask,
  seed,
  signedIn,
  task,
} from './helpers.js';

const ADMIN = { uid: 'uid-admin', email: 'admin@example.com' };
const INES = { uid: 'uid-ines', email: 'ines@example.com' }; // desactivada, para eliminarla (Q-10)

const HOUR = 60 * 60 * 1000;
const ALL_OFF = Object.fromEntries(FEATURE_KEYS.map((key) => [key, false]));

let env;
let entryCount = 0;

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(() => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, {
    'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: true, uid: ADMIN.uid },
    'allowedUsers/ana@example.com': { name: 'Ana' }, // documento legado, sin permissions
    'allowedUsers/beto@example.com': { name: 'Beto', role: 'member', active: true, uid: BETO.uid },
    ...indexedTask('ana-1', task(ANA.uid)),
    ...indexedTask('beto-1', task(BETO.uid, { priority: 'urgent', dueDate: '2026-11-20' })),
    ...indexedTask('beto-sin-etiquetas', task(BETO.uid)),
    ...indexedTask('admin-1', task(ADMIN.uid, { priority: 'high', dueDate: '2026-11-20' })),
  });
});

// Permisos guardados de una persona (sin reglas, como los dejaría la consola o el panel).
const withPermissions = (person, permissions, data = {}) =>
  seed(env, {
    [`allowedUsers/${person.email}`]: {
      name: 'Persona',
      role: 'member',
      active: true,
      uid: person.uid,
      ...data,
      permissions,
    },
  });

/**
 * Todo lo que hace el dueño con su tablero, una operación tras otra, comprobada con assertSucceeds o
 * assertFails: leer y consultar sus tareas y su índice, crear una tarea con su índice, editarla, completar
 * el índice de una tarea antigua, reescribir un índice, borrar un índice huérfano y borrar una tarea.
 */
async function checkOwnBoard(assert, person, taskId) {
  await seed(env, {
    [`tasks/${taskId}-antigua`]: task(person.uid),
    [`taskIndex/${taskId}-huerfano`]: { ownerId: person.uid },
  });
  const db = signedIn(env, person);
  await assert(getDoc(doc(db, `tasks/${taskId}`)));
  await assert(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', person.uid))));
  await assert(getDoc(doc(db, `taskIndex/${taskId}`)));
  await assert(getDocs(query(collection(db, 'taskIndex'), where('ownerId', '==', person.uid))));
  await assert(saveTask(db, `${taskId}-nueva`, task(person.uid)));
  await assert(updateDoc(doc(db, `tasks/${taskId}`), { text: 'Cambiada' }));
  await assert(setDoc(doc(db, `taskIndex/${taskId}-antigua`), { ownerId: person.uid }));
  await assert(setDoc(doc(db, `taskIndex/${taskId}`), { ownerId: person.uid }));
  await assert(deleteDoc(doc(db, `taskIndex/${taskId}-huerfano`)));
  await assert(removeTask(db, taskId));
}

// Pone y cambia prioridad y fecha límite: al crear y al editar.
async function checkLabels(assert, person, taskId) {
  const db = signedIn(env, person);
  await assert(saveTask(db, `${taskId}-con-prioridad`, task(person.uid, { priority: 'high' })));
  await assert(saveTask(db, `${taskId}-con-fecha`, task(person.uid, { dueDate: '2026-12-01' })));
  await assert(updateDoc(doc(db, `tasks/${taskId}`), { priority: 'low' }));
  await assert(updateDoc(doc(db, `tasks/${taskId}`), { dueDate: '2026-12-02' }));
}

const newEntryId = () => `entrada-${++entryCount}`;

// Entrada del registro como la escribe la app: solo uids y la hora del servidor.
function logEntry(actor, action, targetUid = null, extra = {}) {
  return { action, actorUid: actor.uid, targetUid, at: serverTimestamp(), ...extra };
}

// Cambio del administrador sobre allowedUsers con su entrada en el mismo lote (entry: null, sin entrada).
function adminChange(db, email, fields, { action = 'set-permissions', actor = ADMIN, entry } = {}) {
  const entryId = newEntryId();
  const batch = writeBatch(db);
  batch.update(doc(db, `allowedUsers/${email}`), { ...fields, lastChange: entryId });
  if (entry !== null) batch.set(doc(db, `adminLog/${entryId}`), entry ?? logEntry(actor, action));
  return batch.commit();
}

async function stored(path) {
  let data = null;
  await env.withSecurityRulesDisabled(async (context) => {
    data = (await getDoc(doc(context.firestore(), path))).data() ?? null;
  });
  return data;
}

describe('Q-1 documento sin permissions (legado)', () => {
  it('trabaja con su tablero y su índice, y pone prioridad y fecha', async () => {
    await checkOwnBoard(assertSucceeds, ANA, 'ana-1');
    await seed(env, indexedTask('ana-2', task(ANA.uid)));
    await checkLabels(assertSucceeds, ANA, 'ana-2');
  });

  it.each([
    ['vacío', {}],
    ['con todo en true', Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]))],
    ['con solo las hijas sin datos apagadas', { stalledAlerts: false, reminders: false, history: false }],
  ])('igual con un mapa %s', async (_, permissions) => {
    await withPermissions(BETO, permissions);
    await checkLabels(assertSucceeds, BETO, 'beto-1');
    await checkOwnBoard(assertSucceeds, BETO, 'beto-1');
  });
});

describe('Q-2 con el tablero apagado', () => {
  it('no lee, consulta, crea, edita ni borra sus tareas ni sus índices', async () => {
    await withPermissions(BETO, { board: false });
    await checkOwnBoard(assertFails, BETO, 'beto-1');
    await checkLabels(assertFails, BETO, 'beto-1');
  });

  it('no las mueve ni les añade historial, y lo guardado sigue intacto', async () => {
    await withPermissions(BETO, { board: false });
    const ref = doc(signedIn(env, BETO), 'tasks/beto-1');
    await assertFails(updateDoc(ref, { status: 'in-progress', startedAt: 2 }));
    await assertFails(updateDoc(ref, { history: arrayUnion({ id: 'm1', type: 'move', at: 2 }) }));
    expect(await stored('tasks/beto-1')).toMatchObject({ priority: 'urgent', dueDate: '2026-11-20' });
    expect(await stored('taskIndex/beto-1')).toEqual({ ownerId: BETO.uid });
  });

  it('al reactivarlo vuelve a trabajar con todo lo que tenía', async () => {
    await withPermissions(BETO, { board: false, priorities: true });
    await withPermissions(BETO, { board: true, priorities: true });
    const db = signedIn(env, BETO);
    expect((await getDoc(doc(db, 'tasks/beto-1'))).data()).toMatchObject({ priority: 'urgent' });
    await checkOwnBoard(assertSucceeds, BETO, 'beto-1');
  });
});

describe('Q-3 un valor corrupto apaga el tablero', () => {
  it.each([['false'], [0], [1], ['true'], [null], [{ on: true }]])('board = %j', async (board) => {
    await withPermissions(BETO, { board });
    await checkOwnBoard(assertFails, BETO, 'beto-1');
  });

  it('un permissions que no es mapa tampoco concede nada', async () => {
    await withPermissions(BETO, 'todo');
    await checkOwnBoard(assertFails, BETO, 'beto-1');
  });
});

describe('Q-4 con las prioridades apagadas', () => {
  beforeEach(() => withPermissions(BETO, { priorities: false }));

  it('no cambia ni quita la prioridad de una tarea', async () => {
    const db = signedIn(env, BETO);
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { priority: 'low' }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { priority: null }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { priority: deleteField() }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-sin-etiquetas'), { priority: 'urgent' }));
    await assertFails(setDoc(doc(db, 'tasks/beto-1'), task(BETO.uid, { priority: 'low', dueDate: '2026-11-20' })));
  });

  it('no crea una tarea con prioridad', async () => {
    await assertFails(saveTask(signedIn(env, BETO), 'beto-2', task(BETO.uid, { priority: 'high' })));
  });

  it('crea sin prioridad, y mueve o edita el texto de una tarea que ya la tiene', async () => {
    const db = signedIn(env, BETO);
    const { priority: _omitted, ...withoutPriority } = task(BETO.uid);
    await assertSucceeds(saveTask(db, 'beto-2', task(BETO.uid)));
    await assertSucceeds(saveTask(db, 'beto-3', withoutPriority));
    await assertSucceeds(updateDoc(doc(db, 'tasks/beto-1'), { status: 'in-progress', startedAt: 2 }));
    await assertSucceeds(updateDoc(doc(db, 'tasks/beto-1'), { text: 'Cambiada' }));
    const moved = { id: 'm1', type: 'move', at: 3, from: 'in-progress', to: 'completed' };
    await assertSucceeds(
      updateDoc(doc(db, 'tasks/beto-1'), { status: 'completed', completedAt: 3, history: arrayUnion(moved) }),
    );
    expect(await stored('tasks/beto-1')).toMatchObject({ priority: 'urgent', text: 'Cambiada' });
  });

  it('reescribe la tarea con la misma prioridad; ausente y null valen lo mismo', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(saveTask(db, 'beto-1', task(BETO.uid, { priority: 'urgent', dueDate: '2026-11-20' })));
    const { priority: _omitted, ...withoutPriority } = task(BETO.uid);
    await assertSucceeds(saveTask(db, 'beto-sin-etiquetas', withoutPriority));
  });

  it('la fecha límite sigue funcionando', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(updateDoc(doc(db, 'tasks/beto-1'), { dueDate: '2026-12-01' }));
    await assertSucceeds(saveTask(db, 'beto-2', task(BETO.uid, { dueDate: '2026-12-01' })));
  });
});

describe('Q-5 con las fechas límite apagadas', () => {
  beforeEach(() => withPermissions(BETO, { dueDates: false }));

  it('no cambia ni quita la fecha límite de una tarea', async () => {
    const db = signedIn(env, BETO);
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { dueDate: '2026-12-01' }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { dueDate: null }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { dueDate: deleteField() }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-sin-etiquetas'), { dueDate: '2026-12-01' }));
    await assertFails(setDoc(doc(db, 'tasks/beto-1'), task(BETO.uid, { priority: 'urgent', dueDate: '2026-12-01' })));
  });

  it('no crea una tarea con fecha límite', async () => {
    await assertFails(saveTask(signedIn(env, BETO), 'beto-2', task(BETO.uid, { dueDate: '2026-12-01' })));
  });

  it('crea sin fecha, y mueve o edita el texto de una tarea que ya la tiene', async () => {
    const db = signedIn(env, BETO);
    const { dueDate: _omitted, ...withoutDueDate } = task(BETO.uid);
    await assertSucceeds(saveTask(db, 'beto-2', task(BETO.uid)));
    await assertSucceeds(saveTask(db, 'beto-3', withoutDueDate));
    await assertSucceeds(updateDoc(doc(db, 'tasks/beto-1'), { status: 'in-progress', startedAt: 2 }));
    await assertSucceeds(updateDoc(doc(db, 'tasks/beto-1'), { text: 'Cambiada' }));
    await assertSucceeds(saveTask(db, 'beto-1', task(BETO.uid, { priority: 'urgent', dueDate: '2026-11-20' })));
    expect(await stored('tasks/beto-1')).toMatchObject({ dueDate: '2026-11-20' });
  });

  it('la prioridad sigue funcionando', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(updateDoc(doc(db, 'tasks/beto-1'), { priority: 'low' }));
    await assertSucceeds(saveTask(db, 'beto-2', task(BETO.uid, { priority: 'high' })));
  });
});

describe('Q-6 manda el padre', () => {
  it.each([
    ['priorities', { priority: 'low' }],
    ['dueDates', { dueDate: '2026-12-01' }],
  ])('con el tablero apagado y %s encendida no cambia su campo', async (key, fields) => {
    await withPermissions(BETO, { board: false, [key]: true });
    const db = signedIn(env, BETO);
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), fields));
    await assertFails(saveTask(db, 'beto-2', task(BETO.uid, fields)));
  });
});

describe('Q-7 los demás no se ven afectados', () => {
  it('con el tablero y las hijas de Beto apagados, Ana sigue trabajando con todo', async () => {
    await withPermissions(BETO, ALL_OFF);
    await checkLabels(assertSucceeds, ANA, 'ana-1');
    await checkOwnBoard(assertSucceeds, ANA, 'ana-1');
  });

  it('y el administrador también', async () => {
    await withPermissions(BETO, ALL_OFF);
    await checkLabels(assertSucceeds, ADMIN, 'admin-1');
  });
});

describe('Q-8 un administrador tiene siempre todas las funciones', () => {
  it.each([
    ['todo apagado', ALL_OFF],
    ['valores corruptos', { board: 'false', priorities: 0 }],
    ['un permissions que no es mapa', 'todo'],
  ])('con %s conserva su tablero, sus prioridades y sus fechas', async (_, permissions) => {
    await withPermissions(ADMIN, permissions, { name: 'Admin', role: 'admin' });
    await checkLabels(assertSucceeds, ADMIN, 'admin-1');
    await checkOwnBoard(assertSucceeds, ADMIN, 'admin-1');
  });
});

describe('Q-9 cambiar los permisos de otra persona', () => {
  it('el administrador cambia los permisos de un miembro con su entrada set-permissions', async () => {
    const db = signedIn(env, ADMIN);
    const entry = logEntry(ADMIN, 'set-permissions', BETO.uid, { detail: { off: ['board'] } });
    await assertSucceeds(adminChange(db, BETO.email, { permissions: { board: false } }, { entry }));
    // Las seis funciones a la vez caben en el detalle (dos claves como máximo).
    const all = logEntry(ADMIN, 'set-permissions', BETO.uid, { detail: { on: FEATURE_KEYS } });
    const allOn = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]));
    await assertSucceeds(adminChange(db, BETO.email, { permissions: allOn }, { entry: all }));
    expect((await stored('allowedUsers/beto@example.com')).permissions).toEqual(allOn);
  });

  it('también a un documento legado o a una persona desactivada', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(adminChange(db, ANA.email, { permissions: { priorities: false } }));
    await withPermissions(BETO, {}, { active: false });
    await assertSucceeds(adminChange(db, BETO.email, { permissions: { dueDates: false } }));
  });

  it('sin entrada, o con una entrada de otra acción', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(adminChange(db, BETO.email, { permissions: { board: false } }, { entry: null }));
    await assertFails(adminChange(db, BETO.email, { permissions: { board: false } }, { action: 'promote' }));
    await assertFails(adminChange(db, BETO.email, { permissions: { board: false } }, { action: 'deactivate' }));
  });

  it.each([
    ['una clave desconocida', { tablero: false }],
    ['una clave desconocida junto a una válida', { board: false, notas: true }],
    ['un valor que no es booleano', { board: 'false' }],
    ['un valor null', { priorities: null }],
    ['un valor numérico', { history: 0 }],
    ['un mapa anidado', { board: { on: false } }],
    ['un permissions que no es mapa', 'todo'],
    ['una lista', ['board']],
  ])('con %s', async (_, permissions) => {
    await assertFails(adminChange(signedIn(env, ADMIN), BETO.email, { permissions }));
  });

  it('el administrador no cambia sus propios permisos', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(adminChange(db, ADMIN.email, { permissions: { board: false } }));
    await assertFails(adminChange(db, ADMIN.email, { permissions: { board: true } }));
  });

  it('un miembro no cambia los suyos ni los de otra persona, ni con entrada', async () => {
    const db = signedIn(env, BETO);
    await assertFails(adminChange(db, BETO.email, { permissions: { board: true } }, { actor: BETO }));
    await assertFails(adminChange(db, ANA.email, { permissions: { board: false } }, { actor: BETO }));
    await assertFails(updateDoc(doc(db, 'allowedUsers/beto@example.com'), { permissions: { board: true } }));
    await withPermissions(BETO, { priorities: false });
    await assertFails(updateDoc(doc(signedIn(env, BETO), 'allowedUsers/beto@example.com'), { permissions: {} }));
  });

  it('un administrador inactivo o sin correo verificado no los cambia', async () => {
    await assertFails(adminChange(signedIn(env, ADMIN, { verified: false }), BETO.email, { permissions: {} }));
    await seed(env, { 'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: false } });
    await assertFails(adminChange(signedIn(env, ADMIN), BETO.email, { permissions: { board: false } }));
  });

  // Lo que escribe de verdad la app: SetUserPermissions con AdminUsersRepository.
  it('con SetUserPermissions: apaga el tablero, registra la entrada y lo reactiva conservando las hijas', async () => {
    const actor = { ...userFromData(ADMIN.email, { name: 'Admin', role: 'admin', active: true }), uid: ADMIN.uid };
    const deps = {
      adminUsers: createAdminUsersRepository({ db: signedIn(env, ADMIN), fs: firestore }),
      newId: newEntryId,
    };
    const beto = async () => userFromData(BETO.email, await stored('allowedUsers/beto@example.com'));

    expect(await setUserPermissions(actor, await beto(), { priorities: false }, deps)).toEqual({ ok: true });
    expect(await setUserPermissions(actor, await beto(), { board: false }, deps)).toEqual({ ok: true });
    expect((await beto()).permissions).toEqual({ priorities: false, board: false });
    expect(effectivePermissions(await beto())).toEqual(ALL_OFF);
    await checkOwnBoard(assertFails, BETO, 'beto-1');

    expect(await setUserPermissions(actor, await beto(), { board: true }, deps)).toEqual({ ok: true });
    expect(effectivePermissions(await beto())).toMatchObject({ board: true, priorities: false, dueDates: true });
    await assertFails(updateDoc(doc(signedIn(env, BETO), 'tasks/beto-1'), { priority: 'low' }));
    await assertSucceeds(updateDoc(doc(signedIn(env, BETO), 'tasks/beto-1'), { dueDate: '2026-12-01' }));

    const log = await getDocs(collection(signedIn(env, ADMIN), 'adminLog'));
    const entries = log.docs.map((entry) => entry.data());
    expect(entries.map(({ action, targetUid, detail }) => ({ action, targetUid, detail }))).toEqual(
      expect.arrayContaining([
        { action: 'set-permissions', targetUid: BETO.uid, detail: { off: ['priorities'] } },
        { action: 'set-permissions', targetUid: BETO.uid, detail: { off: ['board'] } },
        { action: 'set-permissions', targetUid: BETO.uid, detail: { on: ['board'] } },
      ]),
    );
    expect(entries).toHaveLength(3);
    expect(JSON.stringify(entries)).not.toMatch(/@|Beto/);
  });
});

describe('Q-10 eliminar a una persona con el tablero apagado', () => {
  it('el administrador confirma, borra sus tareas e índices por el índice y termina', async () => {
    await withPermissions(INES, ALL_OFF, { active: false });
    await seed(env, {
      ...indexedTask('ines-1', task(INES.uid, { priority: 'urgent' })),
      ...indexedTask('ines-2', task(INES.uid)),
      'deletions/uid-ines': { state: 'backup-ready', taskCount: 2, backupAt: Date.now() - HOUR, backupHash: 'x' },
    });
    const db = signedIn(env, ADMIN);

    const startId = newEntryId();
    const start = writeBatch(db);
    start.update(doc(db, 'deletions/uid-ines'), { state: 'deleting', confirmedAt: serverTimestamp() });
    start.update(doc(db, 'allowedUsers/ines@example.com'), {
      deleting: { at: serverTimestamp(), doneLogId: 'fin-ines' },
      lastChange: startId,
    });
    start.set(doc(db, `adminLog/${startId}`), logEntry(ADMIN, 'delete-start', INES.uid));
    await assertSucceeds(start.commit());

    const indexed = await getDocs(query(collection(db, 'taskIndex'), where('ownerId', '==', INES.uid)));
    expect(indexed.docs.map(({ id }) => id).sort()).toEqual(['ines-1', 'ines-2']);
    const chunk = writeBatch(db);
    indexed.docs.forEach(({ id }) => {
      chunk.delete(doc(db, `tasks/${id}`));
      chunk.delete(doc(db, `taskIndex/${id}`));
    });
    await assertSucceeds(chunk.commit());

    const finish = writeBatch(db);
    finish.delete(doc(db, 'allowedUsers/ines@example.com'));
    finish.delete(doc(db, 'deletions/uid-ines'));
    finish.set(doc(db, 'adminLog/fin-ines'), logEntry(ADMIN, 'delete-done', INES.uid));
    await assertSucceeds(finish.commit());
    expect(await stored('tasks/ines-1')).toBeNull();
    expect(await stored('allowedUsers/ines@example.com')).toBeNull();
  });
});

describe('Q-11 con el tablero apagado, el administrador sigue sin leer sus tareas', () => {
  beforeEach(() => withPermissions(BETO, { board: false }));

  it('no las lee por id ni por consulta, ni las edita, reasigna o crea', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(getDoc(doc(db, 'tasks/beto-1')));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', BETO.uid))));
    await assertFails(getDocs(collection(db, 'tasks')));
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { text: 'Cambiada' }));
    await assertFails(updateDoc(doc(db, 'tasks/beto-1'), { ownerId: ADMIN.uid }));
    await assertFails(saveTask(db, 'beto-2', task(BETO.uid)));
  });

  it('ni las borra sin el marcador de eliminación', async () => {
    await assertFails(removeTask(signedIn(env, ADMIN), 'beto-1'));
  });
});

// Las reglas repiten el catálogo del dominio: si cambia uno, tiene que cambiar el otro.
describe('las reglas y el catálogo coinciden', () => {
  const rules = readRules();
  const between = (start, end) => rules.slice(rules.indexOf(start), rules.indexOf(end));

  it('featureKeys() de las reglas son las claves de FEATURES', () => {
    const list = between('function featureKeys', 'function isFlag').match(/\[([^\]]*)\]/)[1];
    expect(list.split(',').map((key) => key.trim().replaceAll("'", ''))).toEqual(FEATURE_KEYS);
    FEATURE_KEYS.forEach((key) => expect(between('function isPermissionsMap', '// Cambio del')).toContain(`'${key}'`));
  });

  it('las reglas cumplen exactamente las funciones marcadas con enforcedInRules', () => {
    const enforced = FEATURES.filter(({ enforcedInRules }) => enforcedInRules).map(({ key }) => key);
    const used = [...rules.matchAll(/\b(?:perm|childOn)\(user, '(\w+)'\)/g)].map((match) => match[1]);
    expect([...new Set(used)].sort()).toEqual([...enforced].sort());
  });

  it('los permisos no leen documentos nuevos: reutilizan callerDoc()', () => {
    const permissions = between('function perm(', 'function featureKeys');
    expect(permissions).not.toMatch(/(?<![.\w])(get|exists|getAfter|existsAfter)\(/);
    expect(between('function keepsLockedFields', 'match /tasks/')).not.toMatch(
      /(?<![.\w])(get|exists|getAfter|existsAfter)\(/,
    );
  });
});
