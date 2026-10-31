// Roles, estado activo y uid propio en firestore.rules (docs/PLAN_USUARIOS.md, 1.7 y 1.8, casos
// R-1…R-14). La invariante central: ningún rol, tampoco el de administrador, lee ni toca tareas ajenas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TASK_CHUNK_SIZE } from '../src/data/repositories/FirestoreTaskRepository.js';
import {
  ANA,
  BETO,
  createTestEnvironment,
  indexedTask,
  removeTask,
  saveTask,
  seed,
  signedIn,
  task,
} from './helpers.js';

const ADMIN = { uid: 'uid-admin', email: 'admin@example.com' };
const INES = { uid: 'uid-ines', email: 'ines@example.com' }; // desactivada
const CARLA = { uid: 'uid-carla', email: 'carla@example.com' }; // con cuenta, pero sin autorizar

let env;

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(() => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, {
    'allowedUsers/ana@example.com': { name: 'Ana' },
    'allowedUsers/beto@example.com': { name: 'Beto' },
    'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: true },
    'allowedUsers/ines@example.com': { name: 'Inés', role: 'member', active: false },
    ...indexedTask('ana-1', task(ANA.uid)),
    ...indexedTask('beto-1', task(BETO.uid)),
    ...indexedTask('admin-1', task(ADMIN.uid)),
    ...indexedTask('ines-1', task(INES.uid)),
  });
});

// Cambia el documento de autorización de una persona antes de la prueba.
const authorize = (person, data) => seed(env, { [`allowedUsers/${person.email}`]: data });

// Lee, consulta, crea, edita y borra sus propias tareas (con su índice), una operación tras otra, y
// comprueba cada una con assertSucceeds o assertFails.
async function checkOwnTasks(assert, db, person, taskId) {
  await assert(getDoc(doc(db, `tasks/${taskId}`)));
  await assert(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', person.uid))));
  await assert(saveTask(db, `${taskId}-nueva`, task(person.uid)));
  await assert(updateDoc(doc(db, `tasks/${taskId}`), { text: 'Cambiada' }));
  await assert(removeTask(db, taskId));
}

describe('R-1 documento legado', () => {
  it('un documento con solo name trabaja con sus tareas como miembro activo', async () => {
    await checkOwnTasks(assertSucceeds, signedIn(env, ANA), ANA, 'ana-1');
  });
});

describe('R-2 a R-4 persona desactivada', () => {
  it('R-2 con active: false no lee, crea, edita ni borra sus tareas', async () => {
    await checkOwnTasks(assertFails, signedIn(env, INES), INES, 'ines-1');
  });

  it('R-3 sí lee su propio documento', async () => {
    await assertSucceeds(getDoc(doc(signedIn(env, INES), 'allowedUsers/ines@example.com')));
  });

  it.each([['no'], [0], ['true'], [null]])('R-4 active = %j se trata como inactivo', async (active) => {
    await authorize(ANA, { name: 'Ana', active });
    await checkOwnTasks(assertFails, signedIn(env, ANA), ANA, 'ana-1');
  });
});

describe('R-5 y R-6 lectura de allowedUsers', () => {
  it.each([['root'], ['Admin'], ['admin ']])('R-5 role = %j no da privilegios de administrador', async (role) => {
    await authorize(ANA, { name: 'Ana', role, active: true });
    const db = signedIn(env, ANA);
    await assertFails(getDocs(collection(db, 'allowedUsers')));
    await assertFails(getDoc(doc(db, 'allowedUsers/beto@example.com')));
  });

  it('R-6 un administrador activo lee y lista allowedUsers', async () => {
    const db = signedIn(env, ADMIN);
    await assertSucceeds(getDocs(collection(db, 'allowedUsers')));
    await assertSucceeds(getDoc(doc(db, 'allowedUsers/beto@example.com')));
  });

  it('R-6 un miembro no lista ni lee el documento de otra persona', async () => {
    const db = signedIn(env, ANA);
    await assertFails(getDocs(collection(db, 'allowedUsers')));
    await assertFails(getDoc(doc(db, 'allowedUsers/admin@example.com')));
  });

  it('R-6 un administrador inactivo o sin correo verificado tampoco', async () => {
    await assertFails(getDocs(collection(signedIn(env, ADMIN, { verified: false }), 'allowedUsers')));
    await authorize(ADMIN, { name: 'Admin', role: 'admin', active: false });
    const db = signedIn(env, ADMIN);
    await assertFails(getDocs(collection(db, 'allowedUsers')));
    await assertFails(getDoc(doc(db, 'allowedUsers/beto@example.com')));
  });
});

describe('R-7 y R-8 el administrador y las tareas', () => {
  it('R-7 no lee una tarea ajena por id ni por consulta, con o sin filtro', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(getDoc(doc(db, 'tasks/ana-1')));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
    await assertFails(getDocs(collection(db, 'tasks')));
  });

  it('R-7 no edita, borra ni reasigna una tarea ajena', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { text: 'Cambiada' }));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { ownerId: ADMIN.uid }));
    await assertFails(updateDoc(doc(db, 'tasks/admin-1'), { ownerId: ANA.uid }));
    await assertFails(removeTask(db, 'ana-1'));
  });

  it('R-7 no crea una tarea a nombre de otra persona', async () => {
    await assertFails(saveTask(signedIn(env, ADMIN), 'admin-2', task(ANA.uid)));
  });

  // Desde la sección 2 (2.9), isAdmin() solo aparece en el borrado, atado al marcador de eliminación.
  it('R-7 ninguna regla de lectura, alta o edición de tasks menciona isAdmin()', () => {
    const rules = readFileSync(resolve(import.meta.dirname, '..', 'firestore.rules'), 'utf-8');
    const tasksRules = rules.slice(rules.indexOf('match /tasks/'), rules.indexOf('match /taskIndex/'));
    const statements = tasksRules.split('allow ').slice(1);
    expect(statements.map((statement) => statement.split(':')[0])).toEqual(['read', 'delete', 'create', 'update']);
    statements
      .filter((statement) => !statement.startsWith('delete'))
      .forEach((statement) => expect(statement).not.toMatch(/isAdmin/));
    expect(statements.find((statement) => statement.startsWith('delete'))).toMatch(
      /isAdmin\(\) && isDeletingOwner\(resource\.data\.ownerId\)/,
    );
  });

  it('R-8 el administrador trabaja con sus propias tareas', async () => {
    await checkOwnTasks(assertSucceeds, signedIn(env, ADMIN), ADMIN, 'admin-1');
  });
});

describe('R-9 y R-10 registro del uid propio', () => {
  it.each([
    ['ausente', { name: 'Ana' }],
    ['null', { name: 'Ana', uid: null }],
    ['vacío', { name: 'Ana', uid: '' }],
  ])('R-9 lo registra cuando el campo está %s', async (_, data) => {
    await authorize(ANA, data);
    await assertSucceeds(updateDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com'), { uid: ANA.uid }));
  });

  it('R-10 no cambia un uid ya registrado, ni lo borra ni lo pone en null', async () => {
    await authorize(ANA, { name: 'Ana', uid: ANA.uid });
    const ref = doc(signedIn(env, ANA), 'allowedUsers/ana@example.com');
    await assertFails(updateDoc(ref, { uid: ANA.uid }));
    await assertFails(updateDoc(ref, { uid: 'otro-uid' }));
    await assertFails(updateDoc(ref, { uid: deleteField() }));
    await assertFails(updateDoc(ref, { uid: null }));
  });

  it('R-10 no registra un uid distinto del de su sesión', async () => {
    await assertFails(updateDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com'), { uid: BETO.uid }));
  });

  it.each([[{ role: 'admin' }], [{ active: true }], [{ name: 'Otra' }]])(
    'R-10 no registra el uid junto con %j',
    async (extra) => {
      const ref = doc(signedIn(env, ANA), 'allowedUsers/ana@example.com');
      await assertFails(updateDoc(ref, { uid: ANA.uid, ...extra }));
    },
  );

  it('R-10 no lo escribe en el documento de otra persona', async () => {
    await assertFails(updateDoc(doc(signedIn(env, ANA), 'allowedUsers/beto@example.com'), { uid: ANA.uid }));
  });

  it('R-10 no lo registra estando desactivada ni sin correo verificado', async () => {
    await assertFails(updateDoc(doc(signedIn(env, INES), 'allowedUsers/ines@example.com'), { uid: INES.uid }));
    const unverified = signedIn(env, ANA, { verified: false });
    await assertFails(updateDoc(doc(unverified, 'allowedUsers/ana@example.com'), { uid: ANA.uid }));
  });
});

describe('R-11 y R-12 nadie más escribe en allowedUsers', () => {
  it.each([[{ role: 'admin' }], [{ active: true }], [{ active: false }], [{ permissions: { tablero: true } }]])(
    'R-11 un miembro no cambia su documento: %j',
    async (change) => {
      await assertFails(updateDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com'), change));
    },
  );

  it('R-11 un miembro no cambia su nombre, no se crea un documento ni borra el suyo', async () => {
    await assertFails(updateDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com'), { name: 'Otra' }));
    await assertFails(setDoc(doc(signedIn(env, CARLA), 'allowedUsers/carla@example.com'), { name: 'Carla' }));
    await assertFails(deleteDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com')));
  });

  it('R-12 el administrador no crea, edita ni borra documentos sin su entrada del registro', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(setDoc(doc(db, 'allowedUsers/carla@example.com'), { name: 'Carla' }));
    await assertFails(updateDoc(doc(db, 'allowedUsers/beto@example.com'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'allowedUsers/beto@example.com'), { active: false }));
    await assertFails(deleteDoc(doc(db, 'allowedUsers/beto@example.com')));
  });

  it('R-12 el administrador no cambia su propio rol ni su estado', async () => {
    const ref = doc(signedIn(env, ADMIN), 'allowedUsers/admin@example.com');
    await assertFails(updateDoc(ref, { role: 'member' }));
    await assertFails(updateDoc(ref, { active: false }));
  });
});

describe('R-13 denegación por defecto', () => {
  it.each([
    ['administrador', ADMIN],
    ['miembro', ANA],
  ])('%s: config y colecciones no definidas están denegadas', async (_, person) => {
    // taskIndex tiene reglas propias desde la sección 2 (casos P-9 y P-10 de usuarios.rules.test.js).
    await seed(env, { 'config/general': { valor: 1 } });
    const db = signedIn(env, person);
    await assertFails(getDoc(doc(db, 'config/general')));
    await assertFails(setDoc(doc(db, 'config/general'), { valor: 2 }));
    await assertFails(setDoc(doc(db, 'otraColeccion/x'), { valor: 1 }));
  });
});

// Con las reglas estrictas del índice (2.6) cada tarea suma dos llamadas, una por pieza, así que la app
// escribe en trozos de TASK_CHUNK_SIZE tareas: 1 + 8 × 2 = 17. La lectura del documento de autorización
// cuenta una sola vez aunque la pidan las 16 escrituras. El emulador no aplica el límite de 20 de
// producción (A-23): el límite real se comprueba en Desarrollo (VERIFICACION_MANUAL.md, 7.5).
describe('R-14 límite de get() por petición', () => {
  it(`un trozo de ${TASK_CHUNK_SIZE} altas y otro de ${TASK_CHUNK_SIZE} borrados con su índice no lo superan`, async () => {
    const ids = Array.from({ length: TASK_CHUNK_SIZE }, (_, i) => `ana-lote-${i}`);
    const db = signedIn(env, ANA);

    const creates = writeBatch(db);
    ids.forEach((id) => {
      creates.set(doc(db, `tasks/${id}`), task(ANA.uid));
      creates.set(doc(db, `taskIndex/${id}`), { ownerId: ANA.uid });
    });
    await assertSucceeds(creates.commit());

    const deletes = writeBatch(db);
    ids.forEach((id) => {
      deletes.delete(doc(db, `tasks/${id}`));
      deletes.delete(doc(db, `taskIndex/${id}`));
    });
    await assertSucceeds(deletes.commit());
  });
});
