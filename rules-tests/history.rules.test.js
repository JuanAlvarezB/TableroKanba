// Historial de tareas en firestore.rules (docs/PLAN_USUARIOS.md, 4.3 y 4.7, casos H-1…H-9): history
// es opcional, una lista de 100 eventos como máximo, y hereda la privacidad de su tarea. Las tareas se
// crean y se borran con su índice en el mismo lote, como hace la app (2.6).
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { arrayUnion, collection, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const CARLA = { uid: 'uid-carla', email: 'carla@example.com' }; // con cuenta, pero sin autorizar

// Eventos con la forma de domain/rules/history.js; las reglas solo miran el tipo y el tamaño de la lista.
const created = { id: 'c1', type: 'create', at: 1, text: 'Tarea de prueba' };
const event = (n) => ({ id: `e${n}`, type: 'move', at: n, from: 'pending', to: 'in-progress' });
const events = (count) => Array.from({ length: count }, (_, i) => event(i));

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
    ...indexedTask('ana-1', task(ANA.uid, { history: [created] })),
    ...indexedTask('ana-antigua', task(ANA.uid)),
    ...indexedTask('beto-1', task(BETO.uid, { history: [created] })),
  });
});

describe('H-1 crear una tarea con historial', () => {
  it('acepta la tarea nueva con su evento create, y también sin historial (clientes anteriores)', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(saveTask(db, 'ana-2', task(ANA.uid, { history: [created] })));
    await assertSucceeds(saveTask(db, 'ana-3', task(ANA.uid)));
  });
});

describe('H-2 actualizar con arrayUnion en la misma escritura', () => {
  it('mueve la tarea y añade su evento en un solo updateDoc', async () => {
    const ref = doc(signedIn(env, ANA), 'tasks/ana-1');
    await assertSucceeds(updateDoc(ref, { status: 'in-progress', startedAt: 2, history: arrayUnion(event(2)) }));
    expect((await getDoc(ref)).data().history).toEqual([created, event(2)]);
  });

  it('dos dispositivos que añaden a la vez conservan los eventos de ambos', async () => {
    const ref = doc(signedIn(env, ANA), 'tasks/ana-1');
    await assertSucceeds(updateDoc(ref, { text: 'Desde el móvil', history: arrayUnion(event(2)) }));
    await assertSucceeds(updateDoc(ref, { priority: 'urgent', history: arrayUnion(event(3)) }));
    expect((await getDoc(ref)).data().history).toEqual([created, event(2), event(3)]);
  });

  it('una tarea antigua sin history se edita igual y empieza su historial al cambiar', async () => {
    const ref = doc(signedIn(env, ANA), 'tasks/ana-antigua');
    await assertSucceeds(updateDoc(ref, { text: 'Cambiada' }));
    const derived = { id: 'd:pending:1', type: 'move', at: 1, from: null, to: 'pending', derived: true };
    await assertSucceeds(
      updateDoc(ref, { status: 'in-progress', startedAt: 2, history: arrayUnion(derived, event(2)) }),
    );
  });
});

describe('H-3 tamaño y tipo de history', () => {
  it('acepta 100 eventos al crear y al reemplazar la lista', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(saveTask(db, 'ana-2', task(ANA.uid, { history: events(100) })));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-1'), { history: events(100) }));
  });

  it('rechaza 101 al crear, al reemplazar y al añadir con arrayUnion', async () => {
    await seed(env, indexedTask('ana-llena', task(ANA.uid, { history: events(100) })));
    const db = signedIn(env, ANA);
    await assertFails(saveTask(db, 'ana-2', task(ANA.uid, { history: events(101) })));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history: events(101) }));
    await assertFails(updateDoc(doc(db, 'tasks/ana-llena'), { history: arrayUnion(event(100)) }));
  });

  it.each([
    ['un mapa', { 0: created }],
    ['un texto', 'historial'],
    ['un número', 3],
    ['null', null],
  ])('rechaza history como %s', async (_, history) => {
    const db = signedIn(env, ANA);
    await assertFails(saveTask(db, 'ana-2', task(ANA.uid, { history })));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history }));
  });
});

describe('H-4 solo el dueño lee o escribe el historial', () => {
  it('otra persona no lee ni escribe el historial de una tarea ajena', async () => {
    const db = signedIn(env, BETO);
    await assertFails(getDoc(doc(db, 'tasks/ana-1')));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history: arrayUnion(event(2)) }));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history: [] }));
  });

  it('el administrador no lo lee, ni por id ni por consulta, ni lo escribe', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(getDoc(doc(db, 'tasks/ana-1')));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
    await assertFails(getDocs(collection(db, 'tasks')));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history: arrayUnion(event(2)) }));
  });
});

describe('H-5 compactación', () => {
  it('reemplaza la lista por una más corta en la misma escritura del cambio', async () => {
    await seed(env, indexedTask('ana-llena', task(ANA.uid, { history: events(90) })));
    const ref = doc(signedIn(env, ANA), 'tasks/ana-llena');
    const compacted = [...events(90).slice(-60), event(200)];
    await assertSucceeds(updateDoc(ref, { text: 'Compactada', history: compacted }));
    expect((await getDoc(ref)).data().history).toHaveLength(61);
  });
});

describe('H-6 la lista de campos sigue cerrada', () => {
  it('rechaza un campo desconocido junto al historial, al crear y al editar', async () => {
    const db = signedIn(env, ANA);
    await assertFails(saveTask(db, 'ana-2', task(ANA.uid, { history: [created], historial: [] })));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history: arrayUnion(event(2)), actorId: ANA.uid }));
  });
});

// B-6 (allowedUsers) y B-8 (colecciones no definidas) no tocan tareas: siguen en baseline.rules.test.js.
describe('H-7 la línea base sigue igual con history presente', () => {
  it('B-1 el dueño lee, consulta, crea, edita y borra tareas con historial', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-1')));
    await assertSucceeds(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
    await assertSucceeds(saveTask(db, 'ana-2', task(ANA.uid, { history: [created] })));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-2'), { status: 'completed', completedAt: 3 }));
    await assertSucceeds(removeTask(db, 'ana-2'));
  });

  it('B-2 y R-7 nadie más las lee, tampoco el administrador', async () => {
    for (const person of [BETO, ADMIN]) {
      await assertFails(getDoc(doc(signedIn(env, person), 'tasks/ana-1')));
    }
    await assertFails(getDocs(collection(signedIn(env, ANA), 'tasks')));
  });

  it('B-3 nadie las edita, borra ni reasigna', async () => {
    const ana = signedIn(env, ANA);
    await assertFails(updateDoc(doc(ana, 'tasks/ana-1'), { ownerId: BETO.uid, history: arrayUnion(event(2)) }));
    await assertFails(saveTask(ana, 'ana-2', task(BETO.uid, { history: [created] })));
    const beto = signedIn(env, BETO);
    await assertFails(updateDoc(doc(beto, 'tasks/ana-1'), { text: 'Cambiada' }));
    await assertFails(removeTask(beto, 'ana-1'));
  });

  it.each([
    ['sin sesión', () => env.unauthenticatedContext().firestore()],
    ['correo sin verificar', () => signedIn(env, ANA, { verified: false })],
    ['correo que no está en allowedUsers', () => signedIn(env, CARLA)],
  ])('B-4 %s: no lee, crea, edita ni borra', async (_, database) => {
    const db = database();
    await assertFails(getDoc(doc(db, 'tasks/ana-1')));
    await assertFails(saveTask(db, 'nueva', task(ANA.uid, { history: [created] })));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { history: arrayUnion(event(2)) }));
    await assertFails(removeTask(db, 'ana-1'));
  });

  it('B-5 los demás campos se siguen validando', async () => {
    const db = signedIn(env, ANA);
    await assertFails(saveTask(db, 'ana-2', task(ANA.uid, { text: 'a'.repeat(501), history: [created] })));
    await assertFails(updateDoc(doc(db, 'tasks/ana-1'), { status: 'archived', history: arrayUnion(event(2)) }));
  });

  it('B-7 un correo con mayúsculas trabaja con sus tareas con historial', async () => {
    const db = signedIn(env, { uid: ANA.uid, email: 'Ana@Example.COM' });
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-1')));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-1'), { text: 'Cambiada', history: arrayUnion(event(2)) }));
  });
});

describe('H-8 sin llamadas get() adicionales', () => {
  it('un lote de 8 tareas con historial se acepta al crear y al cambiar', async () => {
    const db = signedIn(env, ANA);
    const ids = Array.from({ length: 8 }, (_, i) => `ana-lote-${i}`);

    const creates = writeBatch(db);
    ids.forEach((id) => {
      creates.set(doc(db, `tasks/${id}`), task(ANA.uid, { history: [created] }));
      creates.set(doc(db, `taskIndex/${id}`), { ownerId: ANA.uid });
    });
    await assertSucceeds(creates.commit());

    const updates = writeBatch(db);
    ids.forEach((id) => updates.update(doc(db, `tasks/${id}`), { text: 'Cambiada', history: arrayUnion(event(2)) }));
    await assertSucceeds(updates.commit());
  });

  it('la comprobación de history no lee otros documentos', () => {
    const rules = readRules();
    const isHistory = rules.slice(rules.indexOf('function isHistory'), rules.indexOf('function isValidTask'));
    expect(isHistory).toContain('data.history.size() <= 100');
    expect(isHistory).not.toMatch(/\b(get|exists|getAfter|existsAfter)\(/);
  });
});

// Reglas sin 'history' en hasOnly ni su comprobación: las de antes de este cambio, que quedarían
// publicadas si se revirtieran sin seguir el procedimiento del README.
function rulesWithoutHistory() {
  return readRules()
    .replace("'ownerId', 'history'])", "'ownerId'])")
    .replace(/\n\s*&& isHistory\(data\)/, '');
}

describe('H-9 con las reglas anteriores, las tareas con history dejan de poder editarse (A-41)', () => {
  let previous;

  beforeAll(async () => {
    const rules = rulesWithoutHistory();
    expect(rules).not.toContain("'history'])");
    expect(rules).not.toContain('&& isHistory(data)');
    previous = await createTestEnvironment({ rules });
  });

  afterAll(async () => {
    await previous?.cleanup();
    // Deja otra vez las reglas de firestore.rules en el emulador.
    await (await createTestEnvironment()).cleanup();
  });

  it('falla cualquier edición de una tarea que ya tiene history, aunque no lo toque', async () => {
    const ref = doc(signedIn(previous, ANA), 'tasks/ana-1');
    await assertFails(updateDoc(ref, { text: 'Cambiada' }));
    await assertFails(updateDoc(ref, { status: 'in-progress', startedAt: 2 }));
    await assertFails(updateDoc(ref, { history: arrayUnion(event(2)) }));
  });

  it('crear con historial también falla; leer, borrar y las tareas sin history siguen funcionando', async () => {
    const db = signedIn(previous, ANA);
    await assertFails(saveTask(db, 'ana-2', task(ANA.uid, { history: [created] })));
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-1')));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-antigua'), { text: 'Cambiada' }));
    await assertSucceeds(removeTask(db, 'ana-1'));
  });
});
