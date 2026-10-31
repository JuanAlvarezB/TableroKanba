// Subtareas en firestore.rules (docs/PLAN_SUBTAREAS.md, 2.3, casos S-1…S-17): subtasks y openSubtasks son
// opcionales, llegan juntos, la lista tiene 20 subtareas como máximo, el contador va de 0 al tamaño de la
// lista y una tarea completada no puede tener subtareas pendientes. Las tareas se crean y se borran con su
// índice en el mismo lote, como hace la app (docs/PLAN_USUARIOS.md, 2.6).
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

// Subtareas con la forma de domain/entities/Task.js; las reglas solo miran el tipo y el tamaño de la lista.
const subtask = (n, done = false) => ({ id: `s${n}`, text: `Paso ${n}`, done });
const subtasks = (count, doneCount = 0) => Array.from({ length: count }, (_, i) => subtask(i, i < doneCount));
// Lista y contador coherentes, como los escribe el dominio (subtaskChanges).
const withSubtasks = (count, doneCount = 0) => ({
  subtasks: subtasks(count, doneCount),
  openSubtasks: count - doneCount,
});
const moveEvent = { id: 'e1', type: 'move', at: 2, from: 'in-progress', to: 'completed' };

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
    'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: true, uid: ADMIN.uid },
    ...indexedTask('ana-antigua', task(ANA.uid)),
    // En curso, con 2 de 4 subtareas terminadas.
    ...indexedTask('ana-media', task(ANA.uid, { status: 'in-progress', startedAt: 2, ...withSubtasks(4, 2) })),
    // En curso, con todas terminadas.
    ...indexedTask('ana-lista', task(ANA.uid, { status: 'in-progress', startedAt: 2, ...withSubtasks(3, 3) })),
    // Completada, con todas terminadas.
    ...indexedTask(
      'ana-hecha',
      task(ANA.uid, { status: 'completed', startedAt: 2, completedAt: 3, ...withSubtasks(2, 2) }),
    ),
    ...indexedTask('beto-1', task(BETO.uid, withSubtasks(2))),
  });
});

const ref = (person, id) => doc(signedIn(env, person), `tasks/${id}`);
const complete = { status: 'completed', completedAt: 5 };

describe('S-1 las tareas sin subtareas siguen igual', () => {
  it('se crean, editan, mueven, completan y borran como hoy', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(saveTask(db, 'ana-nueva', task(ANA.uid)));
    await assertSucceeds(updateDoc(ref(ANA, 'ana-antigua'), { text: 'Cambiada' }));
    await assertSucceeds(updateDoc(ref(ANA, 'ana-antigua'), { status: 'in-progress', startedAt: 2 }));
    await assertSucceeds(updateDoc(ref(ANA, 'ana-antigua'), complete));
    await assertSucceeds(removeTask(db, 'ana-antigua'));
  });
});

describe('S-2 lista y contador coherentes', () => {
  it.each([
    ['una subtarea', withSubtasks(1)],
    ['20 subtareas (tope)', withSubtasks(20, 5)],
    ['todas terminadas', withSubtasks(3, 3)],
    ['la lista vacía', { subtasks: [], openSubtasks: 0 }],
  ])('acepta %s en la misma escritura', async (_, fields) => {
    await assertSucceeds(updateDoc(ref(ANA, 'ana-antigua'), fields));
  });

  it('acepta crear una tarea que ya trae subtareas (migración de la copia local)', async () => {
    await assertSucceeds(saveTask(signedIn(env, ANA), 'ana-migrada', task(ANA.uid, withSubtasks(2, 1))));
  });
});

describe('S-3 tope de 20 subtareas', () => {
  it('rechaza 21 al crear y al actualizar', async () => {
    const tooMany = { subtasks: subtasks(21), openSubtasks: 21 };
    await assertFails(saveTask(signedIn(env, ANA), 'ana-larga', task(ANA.uid, tooMany)));
    await assertFails(updateDoc(ref(ANA, 'ana-antigua'), tooMany));
  });
});

describe('S-4 subtasks tiene que ser una lista', () => {
  it.each([
    ['un mapa', { s1: subtask(1) }],
    ['un texto', 'Paso 1'],
    ['un número', 1],
  ])('rechaza %s', async (_, value) => {
    await assertFails(updateDoc(ref(ANA, 'ana-antigua'), { subtasks: value, openSubtasks: 0 }));
  });
});

describe('S-5 openSubtasks entero entre 0 y el tamaño de la lista', () => {
  it.each([
    ['negativo', -1],
    ['decimal', 1.5],
    ['un texto', '1'],
    ['nulo', null],
    ['mayor que la lista', 3],
  ])('rechaza un contador %s', async (_, value) => {
    await assertFails(updateDoc(ref(ANA, 'ana-antigua'), { subtasks: subtasks(2), openSubtasks: value }));
  });
});

describe('S-6 lista y contador llegan juntos', () => {
  it('rechaza la lista sin contador y el contador sin lista', async () => {
    await assertFails(updateDoc(ref(ANA, 'ana-antigua'), { subtasks: subtasks(2) }));
    await assertFails(updateDoc(ref(ANA, 'ana-antigua'), { openSubtasks: 0 }));
    await assertFails(saveTask(signedIn(env, ANA), 'ana-sola', task(ANA.uid, { subtasks: subtasks(1) })));
  });
});

describe('S-7 una tarea completada no tiene subtareas pendientes', () => {
  it('rechaza crearla completada con pendientes', async () => {
    const data = task(ANA.uid, { status: 'completed', completedAt: 3, ...withSubtasks(2, 1) });
    await assertFails(saveTask(signedIn(env, ANA), 'ana-trampa', data));
  });

  it('rechaza completarla con pendientes aunque envíe la lista', async () => {
    await assertFails(updateDoc(ref(ANA, 'ana-media'), { ...complete, ...withSubtasks(4, 2) }));
  });
});

describe('S-8 completar con el contador en 0 o sin subtareas', () => {
  it('acepta crearla completada sin pendientes', async () => {
    const data = task(ANA.uid, { status: 'completed', completedAt: 3, ...withSubtasks(2, 2) });
    await assertSucceeds(saveTask(signedIn(env, ANA), 'ana-lista-nueva', data));
  });

  it('acepta completar enviando la lista toda terminada', async () => {
    await assertSucceeds(updateDoc(ref(ANA, 'ana-media'), { ...complete, ...withSubtasks(4, 4) }));
  });
});

describe('S-9 cliente viejo: completar sin tocar las subtareas', () => {
  it('rechaza { status, completedAt } sobre una tarea con subtareas pendientes', async () => {
    await assertFails(updateDoc(ref(ANA, 'ana-media'), complete));
    await assertFails(updateDoc(ref(ANA, 'ana-media'), { ...complete, order: 9, history: arrayUnion(moveEvent) }));
  });

  it('los demás cambios de ese cliente siguen funcionando', async () => {
    await assertSucceeds(updateDoc(ref(ANA, 'ana-media'), { text: 'Cambiada' }));
    await assertSucceeds(updateDoc(ref(ANA, 'ana-media'), { status: 'pending', createdAt: 4, completedAt: null }));
  });
});

describe('S-10 reabrir una subtarea de una tarea completada', () => {
  it('rechaza dejar la tarea en Completada con una subtarea pendiente', async () => {
    await assertFails(updateDoc(ref(ANA, 'ana-hecha'), withSubtasks(2, 1)));
  });

  it('acepta devolverla a En curso en la misma escritura', async () => {
    await assertSucceeds(
      updateDoc(ref(ANA, 'ana-hecha'), {
        ...withSubtasks(2, 1),
        status: 'in-progress',
        startedAt: 6,
        completedAt: null,
      }),
    );
  });
});

describe('S-11 completar cuando todas están terminadas', () => {
  it('acepta { status, completedAt } sobre openSubtasks 0', async () => {
    await assertSucceeds(updateDoc(ref(ANA, 'ana-lista'), complete));
  });
});

describe('S-12 nadie más lee ni escribe las subtareas', () => {
  it('otra persona no lee ni escribe las subtareas de una tarea ajena', async () => {
    await assertFails(getDoc(ref(BETO, 'ana-media')));
    await assertFails(updateDoc(ref(BETO, 'ana-media'), withSubtasks(4, 4)));
    await assertFails(updateDoc(ref(ANA, 'beto-1'), withSubtasks(2, 2)));
  });

  it('el administrador no las lee, ni por id ni por consulta, ni las escribe', async () => {
    const db = signedIn(env, ADMIN);
    await assertFails(getDoc(doc(db, 'tasks/ana-media')));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
    await assertFails(updateDoc(doc(db, 'tasks/ana-media'), withSubtasks(4, 4)));
  });

  it('nadie reasigna la tarea junto con sus subtareas', async () => {
    await assertFails(updateDoc(ref(ANA, 'ana-media'), { ...withSubtasks(4, 3), ownerId: BETO.uid }));
  });

  it('el dueño las lee por id y por consulta', async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-media')));
    await assertSucceeds(getDocs(query(collection(db, 'tasks'), where('ownerId', '==', ANA.uid))));
  });
});

describe('S-13 la lista de campos sigue cerrada', () => {
  it('rechaza un campo desconocido junto a las subtareas, al crear y al editar', async () => {
    const extra = { ...withSubtasks(1), progress: '0 de 1' };
    await assertFails(saveTask(signedIn(env, ANA), 'ana-extra', task(ANA.uid, extra)));
    await assertFails(updateDoc(ref(ANA, 'ana-antigua'), extra));
  });
});

describe('S-14 las subtareas no son una función hija', () => {
  const withPermissions = (permissions) =>
    seed(env, {
      'allowedUsers/ana@example.com': { name: 'Ana', role: 'member', active: true, uid: ANA.uid, permissions },
    });

  it('con priorities y dueDates apagadas se cambian igual', async () => {
    await withPermissions({ priorities: false, dueDates: false });
    await assertSucceeds(updateDoc(ref(ANA, 'ana-media'), withSubtasks(4, 3)));
  });

  it('sin el tablero no se leen ni se cambian', async () => {
    await withPermissions({ board: false });
    await assertFails(getDoc(ref(ANA, 'ana-media')));
    await assertFails(updateDoc(ref(ANA, 'ana-media'), withSubtasks(4, 3)));
  });
});

describe('S-15 sin llamadas get() adicionales', () => {
  it('un lote de 8 tareas con subtareas se acepta al crear y al cambiar', async () => {
    const db = signedIn(env, ANA);
    const ids = Array.from({ length: 8 }, (_, i) => `ana-lote-${i}`);

    const creates = writeBatch(db);
    ids.forEach((id) => {
      creates.set(doc(db, `tasks/${id}`), task(ANA.uid, withSubtasks(20, 10)));
      creates.set(doc(db, `taskIndex/${id}`), { ownerId: ANA.uid });
    });
    await assertSucceeds(creates.commit());

    const updates = writeBatch(db);
    ids.forEach((id) => updates.update(doc(db, `tasks/${id}`), withSubtasks(20, 20)));
    await assertSucceeds(updates.commit());
  });

  it('la comprobación de las subtareas no lee otros documentos', () => {
    const rules = readRules();
    const isSubtasks = rules.slice(rules.indexOf('function isSubtasks'), rules.indexOf('function isValidTask'));
    expect(isSubtasks).toContain('data.subtasks.size() <= 20');
    // get() de las reglas lee un documento; data.get() es el método del mapa y no lee nada.
    expect(isSubtasks).not.toMatch(/(?<![.\w])(get|exists|getAfter|existsAfter)\(/);
  });
});

describe('S-16 borrar una tarea con subtareas', () => {
  it('se borra con su índice, como cualquier tarea', async () => {
    await assertSucceeds(removeTask(signedIn(env, ANA), 'ana-media'));
  });
});

// Reglas sin 'subtasks' ni 'openSubtasks' en hasOnly ni su comprobación: las de antes de este cambio, que
// quedarían publicadas si se revirtieran sin seguir el procedimiento del README.
function rulesWithoutSubtasks() {
  return readRules()
    .replace(", 'subtasks', 'openSubtasks']", ']')
    .replace(/\n\s*&& isSubtasks\(data\)/, '');
}

describe('S-17 con las reglas anteriores, las tareas con subtareas dejan de poder editarse (AT-5)', () => {
  let previous;

  beforeAll(async () => {
    const rules = rulesWithoutSubtasks();
    expect(rules).not.toMatch(/hasOnly\(\[[^\]]*'subtasks'/);
    expect(rules).not.toContain('&& isSubtasks(data)');
    previous = await createTestEnvironment({ rules });
  });

  afterAll(async () => {
    await previous?.cleanup();
    // Deja otra vez las reglas de firestore.rules en el emulador.
    await (await createTestEnvironment()).cleanup();
  });

  it('falla cualquier edición de una tarea que ya tiene subtareas, aunque no las toque', async () => {
    const tarea = doc(signedIn(previous, ANA), 'tasks/ana-media');
    await assertFails(updateDoc(tarea, { text: 'Cambiada' }));
    await assertFails(updateDoc(tarea, { status: 'pending', createdAt: 4 }));
  });

  it('leer, borrar y las tareas sin subtareas siguen funcionando', async () => {
    const db = signedIn(previous, ANA);
    await assertSucceeds(getDoc(doc(db, 'tasks/ana-media')));
    await assertSucceeds(updateDoc(doc(db, 'tasks/ana-antigua'), { text: 'Cambiada' }));
    await assertSucceeds(removeTask(db, 'ana-media'));
  });
});
