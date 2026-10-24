// Línea base de firestore.rules (docs/PLAN_USUARIOS.md, 1.8, casos B-1…B-8): el comportamiento actual,
// que debe seguir igual cuando se agreguen los roles.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ANA, BETO, createTestEnvironment, seed, signedIn, task } from './helpers.js';

const CARLA = { uid: 'uid-carla', email: 'carla@example.com' }; // con cuenta, pero sin autorizar
const ANONIMA = { uid: 'uid-anonima' };

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
    'tasks/ana-1': task(ANA.uid),
    'tasks/beto-1': task(BETO.uid),
    'tasks/carla-1': task(CARLA.uid),
    'tasks/anonima-1': task(ANONIMA.uid),
    'config/general': { valor: 1 },
  });
});

describe('B-1 un miembro trabaja con sus tareas', () => {
  it('lee su tarea por id y por consulta filtrada por su ownerId', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-1')));
    await assertSucceeds(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
  });

  it('crea, edita y borra su tarea', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(setDoc(doc(db, 'tasks/ana-2'), task(ANA.uid)));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-2'), { status: 'in-progress', startedAt: 2 }));
    await assertSucceeds(deleteDoc(doc(db, 'tasks/ana-2')));
  });

  it('borrar una tarea que ya no existe no es un error', async () => {
    await assertSucceeds(deleteDoc(doc(signedIn(env, ANA), 'tasks/no-existe')));
  });
});

describe('B-2 nadie lee tareas ajenas', () => {
  it('no lee una tarea ajena por id', async () => {
    await assertFails(getDoc(doc(signedIn(env, ANA), 'tasks/beto-1')));
  });

  it('no consulta las tareas filtradas por otro ownerId', async () => {
    const db = signedIn(env, ANA);
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', BETO.uid))));
  });

  it('no consulta la colección sin filtro', async () => {
    await assertFails(getDocs(collection(signedIn(env, ANA), 'tasks')));
  });
});

describe('B-3 nadie escribe tareas ajenas ni las reasigna', () => {
  it('no crea una tarea con ownerId ajeno', async () => {
    await assertFails(setDoc(doc(signedIn(env, ANA), 'tasks/ana-2'), task(BETO.uid)));
  });

  it('no cambia el ownerId de su tarea', async () => {
    await assertFails(updateDoc(doc(signedIn(env, ANA), 'tasks/ana-1'), { ownerId: BETO.uid }));
  });

  it('no edita una tarea ajena', async () => {
    await assertFails(updateDoc(doc(signedIn(env, ANA), 'tasks/beto-1'), { text: 'Cambiada' }));
  });

  it('no borra una tarea ajena', async () => {
    await assertFails(deleteDoc(doc(signedIn(env, ANA), 'tasks/beto-1')));
  });
});

describe('B-4 sin sesión válida y autorizada no hay acceso a tareas', () => {
  const cases = [
    ['sin sesión', ANA.uid, 'ana-1', () => env.unauthenticatedContext().firestore()],
    [
      'sesión anónima',
      ANONIMA.uid,
      'anonima-1',
      () => env.authenticatedContext(ANONIMA.uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore(),
    ],
    ['correo sin verificar', ANA.uid, 'ana-1', () => signedIn(env, ANA, { verified: false })],
    ['correo que no está en allowedUsers', CARLA.uid, 'carla-1', () => signedIn(env, CARLA)],
  ];

  it.each(cases)('%s: no lee, crea, edita ni borra', async (_, ownerId, taskId, database) => {
    const db = database();
    await assertFails(getDoc(doc(db, `tasks/${taskId}`)));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ownerId))));
    await assertFails(setDoc(doc(db, 'tasks/nueva'), task(ownerId)));
    await assertFails(updateDoc(doc(db, `tasks/${taskId}`), { text: 'Cambiada' }));
    await assertFails(deleteDoc(doc(db, `tasks/${taskId}`)));
  });
});

describe('B-5 lista cerrada de campos y valores de la tarea', () => {
  it('acepta un texto de 500 caracteres (límite)', async () => {
    await assertSucceeds(setDoc(doc(signedIn(env, ANA), 'tasks/ana-2'), task(ANA.uid, { text: 'a'.repeat(500) })));
  });

  it('rechaza un campo extra al crear y al editar', async () => {
    const db = signedIn(env, ANA);
    await assertFails(setDoc(doc(db, 'tasks/ana-2'), task(ANA.uid, { secreto: 'x' })));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { secreto: 'x' }));
  });

  it('rechaza un estado inválido', async () => {
    await assertFails(setDoc(doc(signedIn(env, ANA), 'tasks/ana-2'), task(ANA.uid, { status: 'archived' })));
  });

  it('rechaza un texto de más de 500 caracteres', async () => {
    await assertFails(setDoc(doc(signedIn(env, ANA), 'tasks/ana-2'), task(ANA.uid, { text: 'a'.repeat(501) })));
  });
});

describe('B-6 allowedUsers: cada persona solo lee su propio documento', () => {
  it('lee su propio documento, aunque su correo no esté verificado', async () => {
    await assertSucceeds(getDoc(doc(signedIn(env, ANA), 'allowedUsers/ana@example.com')));
    await assertSucceeds(getDoc(doc(signedIn(env, ANA, { verified: false }), 'allowedUsers/ana@example.com')));
  });

  it('no lee el documento de otra persona', async () => {
    await assertFails(getDoc(doc(signedIn(env, ANA), 'allowedUsers/beto@example.com')));
  });

  it('no lista la colección', async () => {
    await assertFails(getDocs(collection(signedIn(env, ANA), 'allowedUsers')));
  });

  it('no crea, edita ni borra documentos', async () => {
    const db = signedIn(env, ANA);
    await assertFails(setDoc(doc(db, 'allowedUsers/carla@example.com'), { name: 'Carla' }));
    await assertFails(updateDoc(doc(db, 'allowedUsers/ana@example.com'), { name: 'Otra' }));
    await assertFails(deleteDoc(doc(db, 'allowedUsers/ana@example.com')));
  });
});

describe('B-7 el correo del token se compara en minúsculas', () => {
  it('un correo con mayúsculas resuelve su documento y trabaja con sus tareas', async () => {
    const db = signedIn(env, { uid: ANA.uid, email: 'Ana@Example.COM' });
    await assertSucceeds(getDoc(doc(db, 'allowedUsers/ana@example.com')));
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-1')));
    await assertSucceeds(setDoc(doc(db, 'tasks/ana-2'), task(ANA.uid)));
  });
});

describe('B-8 denegación por defecto', () => {
  it('una persona autorizada no lee ni escribe colecciones no definidas', async () => {
    const db = signedIn(env, ANA);
    await assertFails(getDoc(doc(db, 'config/general')));
    await assertFails(setDoc(doc(db, 'otraColeccion/x'), { valor: 1 }));
    await assertFails(setDoc(doc(db, 'tasks/ana-1/notas/x'), { valor: 1 }));
  });
});
