// Gestión de usuarios en firestore.rules, reglas de transición (docs/PLAN_USUARIOS.md, 2.9 y 2.12,
// casos P-1…P-14 y P-20): el administrador escribe allowedUsers solo con su entrada del registro,
// adminLog es inmutable, el marcador de eliminación solo lo crea el script, y las tareas se aceptan
// con o sin su documento de taskIndex. La invariante de siempre: el administrador no lee tareas.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ANA, BETO, createTestEnvironment, seed, signedIn, task } from './helpers.js';

const ADMIN = { uid: 'uid-admin', email: 'admin@example.com' };
const ADMIN2 = { uid: 'uid-admin2', email: 'admin2@example.com' };
const INES = { uid: 'uid-ines', email: 'ines@example.com' }; // desactivada, con respaldo listo
const CARLA = { uid: 'uid-carla', email: 'carla@example.com' }; // con cuenta, sin autorizar
const NUNCA = { email: 'nunca@example.com' }; // autorizada, desactivada y sin uid: nunca entró

const HOUR = 60 * 60 * 1000;

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
    'allowedUsers/admin2@example.com': { name: 'Admin 2', role: 'admin', active: true, uid: ADMIN2.uid },
    'allowedUsers/ana@example.com': { name: 'Ana' }, // documento legado, de antes de los roles
    'allowedUsers/beto@example.com': { name: 'Beto', role: 'member', active: true, uid: BETO.uid },
    'allowedUsers/ines@example.com': { name: 'Inés', role: 'member', active: false, uid: INES.uid },
    'allowedUsers/nunca@example.com': { name: 'Nunca', role: 'member', active: false },
    'tasks/ana-1': task(ANA.uid),
    'taskIndex/ana-1': { ownerId: ANA.uid },
    'tasks/beto-1': task(BETO.uid),
    'taskIndex/beto-1': { ownerId: BETO.uid },
    'tasks/ines-1': task(INES.uid),
    'taskIndex/ines-1': { ownerId: INES.uid },
    'deletions/uid-ines': marker('backup-ready'),
  });
});

// Marcador como lo deja el script tras un respaldo verificado.
function marker(state, { backupAt = Date.now() - HOUR } = {}) {
  return { state, taskCount: 1, backupAt, backupHash: 'huella-ficticia' };
}

const newEntryId = () => `entrada-${++entryCount}`;

// Entrada del registro como la escribe la app: solo uids y la hora del servidor.
function logEntry(actor, action, targetUid = null, extra = {}) {
  return { action, actorUid: actor.uid, targetUid, at: serverTimestamp(), ...extra };
}

/**
 * Cambio del administrador sobre allowedUsers con su entrada en el mismo lote. Con entry: null no
 * escribe la entrada; con lastChange se fuerza otro identificador en el documento.
 */
function adminChange(db, email, fields, { action, actor = ADMIN, entry, entryId = newEntryId(), lastChange } = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, `allowedUsers/${email}`), { ...fields, lastChange: lastChange ?? entryId });
  if (entry !== null) batch.set(doc(db, `adminLog/${entryId}`), entry ?? logEntry(actor, action));
  return batch.commit();
}

function authorizeEmail(db, email, data = {}, { action = 'authorize', actor = ADMIN, entry } = {}) {
  const entryId = newEntryId();
  const batch = writeBatch(db);
  batch.set(doc(db, `allowedUsers/${email}`), {
    name: 'Carla',
    role: 'member',
    active: true,
    lastChange: entryId,
    ...data,
  });
  if (entry !== null) batch.set(doc(db, `adminLog/${entryId}`), entry ?? logEntry(actor, action));
  return batch.commit();
}

// Confirmar la eliminación (2.5, paso 4): marcador a 'deleting', marca en el documento y entrada.
function startDeletion(db, email, key, { fields = {}, markerState = 'deleting', doneLogId = 'fin-ines' } = {}) {
  const entryId = newEntryId();
  const batch = writeBatch(db);
  if (markerState) {
    batch.update(doc(db, `deletions/${key}`), { state: markerState, confirmedAt: serverTimestamp() });
  }
  batch.update(doc(db, `allowedUsers/${email}`), {
    deleting: { at: serverTimestamp(), doneLogId },
    lastChange: entryId,
    ...fields,
  });
  batch.set(doc(db, `adminLog/${entryId}`), logEntry(ADMIN, 'delete-start'));
  return batch.commit();
}

// Persona ya en eliminación, como queda tras confirmar.
async function seedDeleting(person = INES, data = {}) {
  await seed(env, {
    [`allowedUsers/${person.email}`]: {
      name: 'Inés',
      role: 'member',
      active: false,
      uid: INES.uid,
      lastChange: 'inicio-ines',
      deleting: { at: Date.now(), doneLogId: 'fin-ines' },
      ...data,
    },
    'deletions/uid-ines': { ...marker('deleting'), confirmedAt: Date.now() },
  });
}

// Terminar la eliminación (2.5, paso 6): documento, marcador y entrada delete-done juntos.
function finishDeletion(
  db,
  email,
  key,
  { deleteMarker = true, entryId = 'fin-ines', action = 'delete-done', entry, actor = ADMIN } = {},
) {
  const batch = writeBatch(db);
  batch.delete(doc(db, `allowedUsers/${email}`));
  if (deleteMarker) batch.delete(doc(db, `deletions/${key}`));
  if (entry !== null) batch.set(doc(db, `adminLog/${entryId}`), entry ?? logEntry(actor, action, INES.uid));
  return batch.commit();
}

// Crea o borra tareas con su índice en el mismo lote, como FirestoreTaskRepository.
function writeTasks(db, ids, owner, { remove = false, withIndex = true } = {}) {
  const batch = writeBatch(db);
  ids.forEach((id) => {
    if (remove) batch.delete(doc(db, `tasks/${id}`));
    else batch.set(doc(db, `tasks/${id}`), task(owner.uid));
    if (!withIndex) return;
    if (remove) batch.delete(doc(db, `taskIndex/${id}`));
    else batch.set(doc(db, `taskIndex/${id}`), { ownerId: owner.uid });
  });
  return batch.commit();
}

describe('P-1 autorizar un correo', () => {
  it('el administrador autoriza un correo con su entrada de registro, como miembro o administrador', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(authorizeEmail(db, CARLA.email));
    await assertSucceeds(authorizeEmail(db, 'dora@example.com', { name: 'Dora', role: 'admin' }));
    await assertSucceeds(authorizeEmail(db, 'eva@example.com', { name: 'E'.repeat(100) }));
  });
});

describe('P-2 autorizar: casos rechazados', () => {
  it('sin entrada de registro, con entrada de otro actorUid, de otra acción o con hora del cliente', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(authorizeEmail(db, CARLA.email, {}, { entry: null }));
    await assertFails(authorizeEmail(db, CARLA.email, {}, { entry: logEntry(ADMIN2, 'authorize') }));
    await assertFails(authorizeEmail(db, CARLA.email, {}, { action: 'promote' }));
    const clientTime = { ...logEntry(ADMIN, 'authorize'), at: Timestamp.now() };
    await assertFails(authorizeEmail(db, CARLA.email, {}, { entry: clientTime }));
  });

  it('con el correo en mayúsculas o para su propio correo', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(authorizeEmail(db, 'Carla@Example.com'));
    // Su documento ya existe, así que sería una actualización, y tampoco puede cambiar el suyo.
    await assertFails(authorizeEmail(db, ADMIN.email, { name: 'Admin', role: 'admin' }));
  });

  it.each([
    ['uid', { uid: CARLA.uid }],
    ['permissions', { permissions: { tablero: true } }],
    ['deleting', { deleting: { at: 1, doneLogId: 'x' } }],
    ['otro campo', { notas: 'x' }],
  ])('con %s', async (_, extra) => {
    await assertFails(authorizeEmail(signedIn(env, ADMIN), CARLA.email, extra));
  });

  it.each([
    ['role inválido', { role: 'root' }],
    ['active: false', { active: false }],
    ['nombre vacío', { name: '' }],
    ['nombre de más de 100 caracteres', { name: 'C'.repeat(101) }],
  ])('con %s', async (_, data) => {
    await assertFails(authorizeEmail(signedIn(env, ADMIN), CARLA.email, data));
  });

  it('sin role o sin lastChange', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(setDoc(doc(db, 'allowedUsers/carla@example.com'), { name: 'Carla', active: true }));
    await assertFails(
      setDoc(doc(db, 'allowedUsers/carla@example.com'), { name: 'Carla', role: 'member', active: true }),
    );
  });

  it('un miembro, un administrador inactivo o sin correo verificado no autorizan', async () => {
    await assertFails(authorizeEmail(signedIn(env, BETO), CARLA.email, {}, { actor: BETO }));
    await assertFails(authorizeEmail(signedIn(env, ADMIN, { verified: false }), CARLA.email));
    await seed(env, { 'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: false } });
    await assertFails(authorizeEmail(signedIn(env, ADMIN), CARLA.email));
  });

  it('con una entrada authorize escrita en otra petición', async () => {
    await seed(env, { 'adminLog/antigua': { action: 'authorize', actorUid: ADMIN.uid, targetUid: null, at: 1 } });
    const db = signedIn(env, ADMIN);
    const data = { name: 'Carla', role: 'member', active: true, lastChange: 'antigua' };
    await assertFails(setDoc(doc(db, 'allowedUsers/carla@example.com'), data));
  });

  it('no sobrescribe un correo ya autorizado', async () => {
    await assertFails(authorizeEmail(signedIn(env, ADMIN), BETO.email, { name: 'Otra' }));
  });
});

describe('P-3 cambios del administrador sobre otra persona', () => {
  it('desactiva, reactiva, promueve y degrada, cada cambio con su entrada', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(adminChange(db, BETO.email, { active: false }, { action: 'deactivate' }));
    await assertSucceeds(adminChange(db, BETO.email, { active: true }, { action: 'reactivate' }));
    await assertSucceeds(adminChange(db, BETO.email, { role: 'admin' }, { action: 'promote' }));
    await assertSucceeds(adminChange(db, BETO.email, { role: 'member' }, { action: 'demote' }));
    await assertSucceeds(adminChange(db, ADMIN2.email, { role: 'member' }, { action: 'demote' }));
  });

  it('cambia un documento legado (sin role ni active) y los permisos', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(adminChange(db, ANA.email, { active: false }, { action: 'deactivate' }));
    await assertSucceeds(
      adminChange(db, ANA.email, { permissions: { tablero: false } }, { action: 'set-permissions' }),
    );
  });

  it('la entrada puede llevar un detalle pequeño y targetUid', async () => {
    const entry = logEntry(ADMIN, 'promote', BETO.uid, { detail: { from: 'member', to: 'admin' } });
    await assertSucceeds(adminChange(signedIn(env, ADMIN), BETO.email, { role: 'admin' }, { entry }));
  });
});

describe('P-4 cambios rechazados', () => {
  it('el administrador no cambia su propio rol ni su estado, aunque escriba su entrada', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(adminChange(db, ADMIN.email, { role: 'member' }, { action: 'demote' }));
    await assertFails(adminChange(db, ADMIN.email, { active: false }, { action: 'deactivate' }));
  });

  it.each([
    ['uid', { uid: 'otro-uid' }],
    ['name', { name: 'Otra' }],
    ['un campo desconocido', { notas: 'x' }],
  ])('no toca %s', async (_, fields) => {
    await assertFails(adminChange(signedIn(env, ADMIN), BETO.email, fields, { action: 'promote' }));
  });

  it('no reutiliza el mismo lastChange ni una entrada de otra petición', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(adminChange(db, BETO.email, { active: false }, { action: 'deactivate', entryId: 'e-1' }));
    // Mismo lastChange: no cambia, y la entrada ya existe (escribirla otra vez sería editarla).
    await assertFails(adminChange(db, BETO.email, { active: true }, { entryId: 'e-1', entry: null }));
    // lastChange nuevo que apunta a una entrada válida, pero escrita en otra petición.
    await seed(env, { 'adminLog/antigua': { action: 'reactivate', actorUid: ADMIN.uid, targetUid: null, at: 1 } });
    await assertFails(adminChange(db, BETO.email, { active: true }, { lastChange: 'antigua', entry: null }));
    // Sin lastChange.
    await assertFails(updateDoc(doc(db, 'allowedUsers/beto@example.com'), { active: true }));
  });

  it('sin entrada, con entrada de otro actorUid o con una acción que no es de cambio', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(adminChange(db, BETO.email, { active: false }, { entry: null }));
    await assertFails(adminChange(db, BETO.email, { active: false }, { entry: logEntry(ADMIN2, 'deactivate') }));
    await assertFails(adminChange(db, BETO.email, { active: false }, { action: 'authorize' }));
  });

  it.each([
    ['role inválido', { role: 'root' }],
    ['active que no es booleano', { active: 'no' }],
    ['permissions que no es mapa', { permissions: 'todo' }],
  ])('con %s', async (_, fields) => {
    await assertFails(adminChange(signedIn(env, ADMIN), BETO.email, fields, { action: 'promote' }));
  });

  it('no reactiva ni cambia a una persona en eliminación, ni le quita la marca', async () => {
    await seedDeleting();
    const db = signedIn(env, ADMIN);
    await assertFails(adminChange(db, INES.email, { active: true }, { action: 'reactivate' }));
    await assertFails(adminChange(db, INES.email, { role: 'admin' }, { action: 'promote' }));
    await assertFails(adminChange(db, INES.email, { deleting: null, active: true }, { action: 'reactivate' }));
  });

  it('un miembro no escribe ningún campo de otra persona ni el suyo, ni con entrada', async () => {
    const db = signedIn(env, BETO);
    await assertFails(adminChange(db, ANA.email, { active: false }, { actor: BETO, action: 'deactivate' }));
    await assertFails(adminChange(db, BETO.email, { role: 'admin' }, { actor: BETO, action: 'promote' }));
    await assertFails(updateDoc(doc(db, 'allowedUsers/beto@example.com'), { lastChange: 'x' }));
  });
});

describe('P-5 confirmar la eliminación', () => {
  it('se acepta con la persona desactivada, miembro y marcador listo de menos de 24 horas', async () => {
    await assertSucceeds(startDeletion(signedIn(env, ADMIN), INES.email, INES.uid));
  });

  it('y con quien nunca entró: el marcador usa su correo', async () => {
    await seed(env, { 'deletions/nunca@example.com': { ...marker('backup-ready'), taskCount: 0 } });
    await assertSucceeds(startDeletion(signedIn(env, ADMIN), NUNCA.email, NUNCA.email));
  });

  it('se rechaza con la persona activa o siendo administradora', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(startDeletion(db, INES.email, INES.uid, { fields: { active: true } }));
    await seed(env, { 'allowedUsers/ines@example.com': { name: 'Inés', role: 'admin', active: false, uid: INES.uid } });
    await assertFails(startDeletion(db, INES.email, INES.uid));
  });

  it('se rechaza sin marcador, con el marcador en backup-ready o con un respaldo de más de 24 horas', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(startDeletion(db, INES.email, INES.uid, { markerState: null }));
    await env.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), 'deletions/uid-ines')));
    await assertFails(startDeletion(db, INES.email, INES.uid, { markerState: null }));
    await seed(env, { 'deletions/uid-ines': marker('backup-ready', { backupAt: Date.now() - 25 * HOUR }) });
    await assertFails(startDeletion(db, INES.email, INES.uid));
  });

  it('se rechaza con el marcador de otra persona o con una marca mal formada', async () => {
    const db = signedIn(env, ADMIN);
    await seed(env, { 'deletions/uid-beto': marker('backup-ready') });
    await assertFails(startDeletion(db, INES.email, BETO.uid));
    const extra = { fields: { deleting: { at: serverTimestamp(), doneLogId: 'fin', notas: 'x' } } };
    await assertFails(startDeletion(db, INES.email, INES.uid, extra));
    const clientTime = { fields: { deleting: { at: Date.now(), doneLogId: 'fin' } } };
    await assertFails(startDeletion(db, INES.email, INES.uid, clientTime));
  });

  it('el administrador no se marca a sí mismo y un miembro no marca a nadie', async () => {
    await seed(env, { 'deletions/uid-admin': marker('backup-ready') });
    await assertFails(
      startDeletion(signedIn(env, ADMIN), ADMIN.email, ADMIN.uid, { fields: { active: false, role: 'member' } }),
    );
    await assertFails(startDeletion(signedIn(env, BETO), INES.email, INES.uid));
  });
});

describe('P-6 terminar la eliminación', () => {
  it('borra el documento con su marca, la entrada doneLogId y el marcador en el mismo lote', async () => {
    await seedDeleting();
    await assertSucceeds(finishDeletion(signedIn(env, ADMIN), INES.email, INES.uid));
  });

  it('y la de quien nunca entró, con el marcador por correo', async () => {
    await seed(env, {
      'allowedUsers/nunca@example.com': {
        name: 'Nunca',
        role: 'member',
        active: false,
        deleting: { at: Date.now(), doneLogId: 'fin-ines' },
      },
      'deletions/nunca@example.com': { ...marker('deleting'), taskCount: 0 },
    });
    await assertSucceeds(finishDeletion(signedIn(env, ADMIN), NUNCA.email, NUNCA.email));
  });

  it('se rechaza si falta cualquiera de las tres piezas', async () => {
    await seedDeleting();
    const db = signedIn(env, ADMIN);
    await assertFails(finishDeletion(db, INES.email, INES.uid, { entry: null }));
    await assertFails(finishDeletion(db, INES.email, INES.uid, { entryId: 'otra-entrada' }));
    await assertFails(finishDeletion(db, INES.email, INES.uid, { action: 'delete-start' }));
    await assertFails(finishDeletion(db, INES.email, INES.uid, { deleteMarker: false }));
    await assertFails(finishDeletion(db, INES.email, 'uid-equivocado'));
  });

  it('se rechaza sin la marca deleting en el documento', async () => {
    await assertFails(finishDeletion(signedIn(env, ADMIN), INES.email, INES.uid));
  });

  it('nunca a un administrador ni a sí mismo; un miembro no borra a nadie', async () => {
    await seedDeleting(INES, { role: 'admin' });
    await assertFails(finishDeletion(signedIn(env, ADMIN), INES.email, INES.uid));
    await seedDeleting();
    await assertFails(finishDeletion(signedIn(env, BETO), INES.email, INES.uid, { actor: BETO }));
    await seed(env, {
      'allowedUsers/admin@example.com': {
        name: 'Admin',
        role: 'admin',
        active: true,
        uid: ADMIN.uid,
        deleting: { at: 1, doneLogId: 'fin-ines' },
      },
    });
    await assertFails(finishDeletion(signedIn(env, ADMIN), ADMIN.email, ADMIN.uid));
  });

  it('sin marca de eliminación, un borrado simple tampoco se admite', async () => {
    await assertFails(deleteDoc(doc(signedIn(env, ADMIN), 'allowedUsers/beto@example.com')));
  });
});

describe('P-7 el registro es inmutable', () => {
  it('el administrador crea una entrada válida y lee el registro', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(setDoc(doc(db, 'adminLog/e-1'), logEntry(ADMIN, 'delete-cancel', INES.uid)));
    await assertSucceeds(getDoc(doc(db, 'adminLog/e-1')));
    await assertSucceeds(getDocs(collection(db, 'adminLog')));
  });

  it.each([
    ['hora del cliente', { at: Timestamp.now() }],
    ['hora en milisegundos', { at: Date.now() }],
    ['actorUid ajeno', { actorUid: ADMIN2.uid }],
    ['una clave de más', { email: 'ana@example.com' }],
    ['una acción desconocida', { action: 'borrar-todo' }],
    ['una acción del script', { action: 'backup' }],
    ['targetUid que no es texto', { targetUid: 7 }],
    ['detail que no es mapa', { detail: 'texto' }],
    ['detail con más de 5 claves', { detail: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } }],
  ])('rechaza una entrada con %s', async (_, change) => {
    await assertFails(setDoc(doc(signedIn(env, ADMIN), 'adminLog/e-1'), { ...logEntry(ADMIN, 'promote'), ...change }));
  });

  it('rechaza una entrada sin acción, sin actorUid, sin targetUid o sin hora', async () => {
    const db = signedIn(env, ADMIN);
    for (const field of ['action', 'actorUid', 'targetUid', 'at']) {
      const { [field]: _omitted, ...entry } = logEntry(ADMIN, 'promote');
      await assertFails(setDoc(doc(db, `adminLog/sin-${field}`), entry));
    }
  });

  it('nadie edita ni borra una entrada, tampoco quien la escribió', async () => {
    await seed(env, { 'adminLog/e-1': { action: 'promote', actorUid: ADMIN.uid, targetUid: BETO.uid, at: 1 } });
    const db = signedIn(env, ADMIN);
    await assertFails(updateDoc(doc(db, 'adminLog/e-1'), { action: 'demote' }));
    await assertFails(setDoc(doc(db, 'adminLog/e-1'), logEntry(ADMIN, 'promote')));
    await assertFails(deleteDoc(doc(db, 'adminLog/e-1')));
  });

  it('un miembro no lee, lista ni escribe el registro', async () => {
    await seed(env, { 'adminLog/e-1': { action: 'promote', actorUid: ADMIN.uid, targetUid: BETO.uid, at: 1 } });
    const db = signedIn(env, BETO);
    await assertFails(getDoc(doc(db, 'adminLog/e-1')));
    await assertFails(getDocs(collection(db, 'adminLog')));
    await assertFails(setDoc(doc(db, 'adminLog/e-2'), logEntry(BETO, 'promote')));
  });
});

describe('P-8 marcador de eliminación', () => {
  it('ningún cliente lo crea, tampoco el administrador', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(setDoc(doc(db, 'deletions/uid-beto'), marker('backup-ready')));
    await assertFails(setDoc(doc(db, 'deletions/uid-beto'), marker('deleting')));
    await assertFails(setDoc(doc(signedIn(env, BETO), 'deletions/uid-beto'), marker('backup-ready')));
  });

  it('el administrador lo lee, lo confirma y cancela uno listo', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(getDoc(doc(db, 'deletions/uid-ines')));
    await assertSucceeds(getDocs(collection(db, 'deletions')));
    await assertSucceeds(
      updateDoc(doc(db, 'deletions/uid-ines'), { state: 'deleting', confirmedAt: serverTimestamp() }),
    );
    await seed(env, { 'deletions/uid-beto': marker('backup-ready') });
    await assertSucceeds(deleteDoc(doc(db, 'deletions/uid-beto')));
  });

  it('no vuelve de deleting a backup-ready ni cambia otros campos u hora del cliente', async () => {
    const db = signedIn(env, ADMIN);
    const ref = doc(db, 'deletions/uid-ines');
    await assertFails(updateDoc(ref, { state: 'deleting', confirmedAt: Timestamp.now() }));
    await assertFails(updateDoc(ref, { state: 'deleting', confirmedAt: serverTimestamp(), taskCount: 0 }));
    await assertFails(updateDoc(ref, { backupAt: Date.now() }));
    await assertFails(updateDoc(ref, { state: 'otro', confirmedAt: serverTimestamp() }));
    await seed(env, { 'deletions/uid-ines': marker('deleting') });
    await assertFails(updateDoc(ref, { state: 'backup-ready' }));
  });

  it('un miembro no lo lee, lista, cambia ni borra', async () => {
    const db = signedIn(env, INES);
    await assertFails(getDoc(doc(db, 'deletions/uid-ines')));
    await assertFails(getDocs(collection(signedIn(env, BETO), 'deletions')));
    await assertFails(updateDoc(doc(signedIn(env, BETO), 'deletions/uid-ines'), { state: 'deleting' }));
    await assertFails(deleteDoc(doc(signedIn(env, BETO), 'deletions/uid-ines')));
  });
});

describe('P-9 el dueño y el índice de sus tareas', () => {
  it('crea y borra su tarea junto con su índice, en el mismo lote', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(writeTasks(db, ['beto-2'], BETO));
    await assertSucceeds(writeTasks(db, ['beto-2'], BETO, { remove: true }));
  });

  it('borra el índice de una tarea que otro dispositivo ya borró', async () => {
    await assertSucceeds(writeTasks(signedIn(env, BETO), ['beto-ya-borrada'], BETO, { remove: true }));
  });

  it('reescribe su índice sin cambiarlo (lote repetido o dos pestañas)', async () => {
    await assertSucceeds(setDoc(doc(signedIn(env, BETO), 'taskIndex/beto-1'), { ownerId: BETO.uid }));
  });

  it('no crea un índice de otro dueño ni con más campos', async () => {
    const db = signedIn(env, BETO);
    await assertFails(setDoc(doc(db, 'taskIndex/beto-2'), { ownerId: ANA.uid }));
    await assertFails(setDoc(doc(db, 'taskIndex/beto-2'), { ownerId: BETO.uid, text: 'Tarea' }));
    await assertFails(setDoc(doc(db, 'taskIndex/beto-2'), { ownerId: 7 }));
    await assertFails(setDoc(doc(db, 'taskIndex/beto-2'), {}));
  });

  it('no edita el índice: ni cambia el dueño ni añade campos', async () => {
    const db = signedIn(env, BETO);
    await assertFails(updateDoc(doc(db, 'taskIndex/beto-1'), { ownerId: ANA.uid }));
    await assertFails(updateDoc(doc(db, 'taskIndex/beto-1'), { status: 'pending' }));
    await assertFails(setDoc(doc(signedIn(env, ANA), 'taskIndex/beto-1'), { ownerId: ANA.uid }));
  });

  it('no borra el índice de otra persona; una persona desactivada no toca el suyo', async () => {
    await assertFails(deleteDoc(doc(signedIn(env, BETO), 'taskIndex/ana-1')));
    await assertFails(deleteDoc(doc(signedIn(env, INES), 'taskIndex/ines-1')));
    await assertFails(setDoc(doc(signedIn(env, INES), 'taskIndex/ines-2'), { ownerId: INES.uid }));
  });

  // En las reglas estrictas (PR 6) estos dos casos pasan a rechazarse.
  it('transición: acepta todavía una tarea sin índice y un índice sin tarea', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(writeTasks(db, ['beto-sin-indice'], BETO, { withIndex: false }));
    await assertSucceeds(setDoc(doc(db, 'taskIndex/beto-solo-indice'), { ownerId: BETO.uid }));
    await assertSucceeds(writeTasks(db, ['beto-1'], BETO, { remove: true, withIndex: false }));
  });
});

describe('P-10 lectura de taskIndex', () => {
  it('el administrador lee y lista el índice de todas las personas', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(getDoc(doc(db, 'taskIndex/ana-1')));
    await assertSucceeds(getDocs(collection(db, 'taskIndex')));
    await assertSucceeds(getDocs(query(collection(db, 'taskIndex'), where('ownerId', '==', INES.uid))));
  });

  it('el dueño lee y consulta su propio índice', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(getDoc(doc(db, 'taskIndex/beto-1')));
    await assertSucceeds(getDocs(query(collection(db, 'taskIndex'), where('ownerId', '==', BETO.uid))));
  });

  it('un miembro no lee el índice de otro, ni lista la colección', async () => {
    const db = signedIn(env, BETO);
    await assertFails(getDoc(doc(db, 'taskIndex/ana-1')));
    await assertFails(getDocs(query(collection(db, 'taskIndex'), where('ownerId', '==', ANA.uid))));
    await assertFails(getDocs(collection(db, 'taskIndex')));
  });

  it('una persona desactivada no lee su índice', async () => {
    await assertFails(getDoc(doc(signedIn(env, INES), 'taskIndex/ines-1')));
  });
});

describe('P-11 el administrador sigue sin leer ni editar tareas ajenas', () => {
  beforeEach(() => seed(env, { 'deletions/uid-ines': marker('deleting'), 'deletions/uid-beto': marker('deleting') }));

  it('no lee una tarea ajena por id ni por consulta, con índice y marcadores presentes', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(getDoc(doc(db, 'tasks/beto-1')));
    await assertFails(getDoc(doc(db, 'tasks/ines-1')));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', INES.uid))));
    await assertFails(getDocs(collection(db, 'tasks')));
  });

  it('no edita, reasigna ni crea tareas ajenas', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(updateDoc(doc(db, 'tasks/ines-1'), { text: 'Cambiada' }));
    await assertFails(updateDoc(doc(db, 'tasks/ines-1'), { history: arrayUnion({ id: 'x', type: 'edit', at: 1 }) }));
    await assertFails(updateDoc(doc(db, 'tasks/ines-1'), { ownerId: ADMIN.uid }));
    await assertFails(setDoc(doc(db, 'tasks/ines-1'), task(INES.uid, { text: 'Reemplazada' })));
    await assertFails(setDoc(doc(db, 'tasks/ines-2'), task(INES.uid)));
  });

  it('no crea ni edita índices de otra persona', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(setDoc(doc(db, 'taskIndex/ines-2'), { ownerId: INES.uid }));
    await assertFails(updateDoc(doc(db, 'taskIndex/ines-1'), { ownerId: ADMIN.uid }));
  });
});

describe('P-12 borrar las tareas de una persona en eliminación', () => {
  it('el administrador borra tarea e índice con el marcador en deleting', async () => {
    await seed(env, { 'deletions/uid-ines': marker('deleting') });
    await assertSucceeds(writeTasks(signedIn(env, ADMIN), ['ines-1'], INES, { remove: true }));
  });

  it('borrar lo que ya no existe no es un error (reanudar)', async () => {
    await seed(env, { 'deletions/uid-ines': marker('deleting') });
    const db = signedIn(env, ADMIN);
    await assertSucceeds(writeTasks(db, ['ines-1'], INES, { remove: true }));
    await assertSucceeds(writeTasks(db, ['ines-1'], INES, { remove: true }));
  });

  it('no con el marcador en backup-ready ni sin marcador', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(writeTasks(db, ['ines-1'], INES, { remove: true }));
    await assertFails(deleteDoc(doc(db, 'tasks/ines-1')));
    await assertFails(deleteDoc(doc(db, 'taskIndex/ines-1')));
    await assertFails(deleteDoc(doc(db, 'tasks/beto-1')));
    await assertFails(deleteDoc(doc(db, 'taskIndex/beto-1')));
  });

  it('no las de otra persona, aunque haya un marcador en deleting', async () => {
    await seed(env, { 'deletions/uid-ines': marker('deleting') });
    const db = signedIn(env, ADMIN);
    await assertFails(deleteDoc(doc(db, 'tasks/beto-1')));
    await assertFails(deleteDoc(doc(db, 'taskIndex/beto-1')));
  });

  it('un miembro o un administrador inactivo no las borran, aunque haya marcador', async () => {
    await seed(env, { 'deletions/uid-ines': marker('deleting') });
    await assertFails(writeTasks(signedIn(env, BETO), ['ines-1'], INES, { remove: true }));
    await seed(env, { 'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: false } });
    await assertFails(writeTasks(signedIn(env, ADMIN), ['ines-1'], INES, { remove: true }));
  });
});

describe('P-13 las personas actuales siguen trabajando con las reglas de transición', () => {
  it('un documento con solo name crea, lee, edita, mueve y borra sus tareas sin índice', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(setDoc(doc(db, 'tasks/ana-2'), task(ANA.uid)));
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-2')));
    await assertSucceeds(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-2'), { text: 'Cambiada' }));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-2'), { status: 'in-progress', startedAt: 2 }));
    await assertSucceeds(deleteDoc(doc(db, 'tasks/ana-2')));
  });

  it('y con índice: crea, edita y mueve sin tocarlo, y lo borra con la tarea', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(writeTasks(db, ['ana-3'], ANA));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-3'), { text: 'Cambiada' }));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-3'), { status: 'completed', completedAt: 3 }));
    await assertSucceeds(getDoc(doc(db, 'taskIndex/ana-3')));
    await assertSucceeds(writeTasks(db, ['ana-3'], ANA, { remove: true }));
  });

  it('completa el índice de sus tareas existentes y borra los huérfanos', async () => {
    await seed(env, { 'tasks/ana-antigua': task(ANA.uid), 'taskIndex/ana-huerfano': { ownerId: ANA.uid } });
    const db = signedIn(env, ANA);
    const batch = writeBatch(db);
    batch.set(doc(db, 'taskIndex/ana-antigua'), { ownerId: ANA.uid });
    batch.delete(doc(db, 'taskIndex/ana-huerfano'));
    await assertSucceeds(batch.commit());
  });

  it('una tarea con historial se crea con su índice y se edita con arrayUnion', async () => {
    const db = signedIn(env, ANA);
    const created = { id: 'c1', type: 'create', at: 1, text: 'Tarea de prueba' };
    const batch = writeBatch(db);
    batch.set(doc(db, 'tasks/ana-4'), task(ANA.uid, { history: [created] }));
    batch.set(doc(db, 'taskIndex/ana-4'), { ownerId: ANA.uid });
    await assertSucceeds(batch.commit());
    const moved = { id: 'm1', type: 'move', at: 2, from: 'pending', to: 'in-progress' };
    await assertSucceeds(
      updateDoc(doc(db, 'tasks/ana-4'), { status: 'in-progress', startedAt: 2, history: arrayUnion(moved) }),
    );
  });

  it('registra su uid en su primer acceso como antes', async () => {
    await assertSucceeds(updateDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com'), { uid: ANA.uid }));
  });
});

describe('P-14 reautorizar un correo eliminado empieza limpio', () => {
  it('tras eliminarla, el documento nuevo es mínimo y la persona vuelve a registrar su uid', async () => {
    await seedDeleting();
    const admin = signedIn(env, ADMIN);
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'tasks/ines-1'));
      await deleteDoc(doc(context.firestore(), 'taskIndex/ines-1'));
    });
    await assertSucceeds(finishDeletion(admin, INES.email, INES.uid));

    await assertSucceeds(authorizeEmail(admin, INES.email, { name: 'Inés' }));
    const data = (await getDoc(doc(admin, 'allowedUsers/ines@example.com'))).data();
    expect(Object.keys(data).sort()).toEqual(['active', 'lastChange', 'name', 'role']);
    expect(data).toMatchObject({ name: 'Inés', role: 'member', active: true });

    const ines = signedIn(env, INES);
    await assertSucceeds(updateDoc(doc(ines, 'allowedUsers/ines@example.com'), { uid: INES.uid }));
    const own = await getDocs(query(collection(ines, 'taskIndex'), where('ownerId', '==', INES.uid)));
    expect(own.size).toBe(0);
  });

  it('no se puede reautorizar heredando uid, permisos ni la marca de eliminación', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(authorizeEmail(db, 'ex@example.com', { uid: INES.uid }));
    await assertFails(authorizeEmail(db, 'ex@example.com', { permissions: { tablero: false } }));
    await assertFails(authorizeEmail(db, 'ex@example.com', { deleting: { at: 1, doneLogId: 'x' } }));
  });
});

describe('P-20 tamaño del trozo: 8 tareas con su índice por lote', () => {
  const ids = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

  it('el dueño crea y borra 8 tareas con sus índices en un lote', async () => {
    const db = signedIn(env, BETO);
    await assertSucceeds(writeTasks(db, ids('beto-lote', 8), BETO));
    await assertSucceeds(writeTasks(db, ids('beto-lote', 8), BETO, { remove: true }));
  });

  it('el administrador borra 8 tareas con sus índices de una persona en eliminación', async () => {
    const owned = ids('ines-lote', 8);
    await seed(env, {
      'deletions/uid-ines': marker('deleting'),
      ...Object.fromEntries(
        owned.flatMap((id) => [
          [`tasks/${id}`, task(INES.uid)],
          [`taskIndex/${id}`, { ownerId: INES.uid }],
        ]),
      ),
    });
    await assertSucceeds(writeTasks(signedIn(env, ADMIN), owned, INES, { remove: true }));
  });

  // Con las reglas de transición las llamadas no dependen del tamaño del lote (siempre los mismos
  // documentos), así que el límite real se mide aparte, en limite-llamadas.rules.test.js.
  it('el administrador borra 25 tareas con sus índices (50 escrituras) en un lote', async () => {
    const owned = ids('ines-grande', 25);
    await seed(env, {
      'deletions/uid-ines': marker('deleting'),
      ...Object.fromEntries(
        owned.flatMap((id) => [
          [`tasks/${id}`, task(INES.uid)],
          [`taskIndex/${id}`, { ownerId: INES.uid }],
        ]),
      ),
    });
    await assertSucceeds(writeTasks(signedIn(env, ADMIN), owned, INES, { remove: true }));
  });
});
