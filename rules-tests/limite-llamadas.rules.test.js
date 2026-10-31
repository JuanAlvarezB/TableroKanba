// Medición del límite de llamadas get/exists/getAfter/existsAfter por lote (docs/PLAN_USUARIOS.md, 2.6 y
// 2.9, caso P-20, alarma A-23) con las reglas estrictas del índice de firestore.rules: cada tarea y cada
// índice comprueban al otro, y todos leen el mismo documento de quien escribe (y, en el borrado del
// administrador, el mismo marcador). Comprueba que los trozos de la app caben y registra hasta dónde
// llega el emulador.
import { assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TASK_CHUNK_SIZE } from '../src/data/repositories/FirestoreTaskRepository.js';
import { DELETION_CHUNK_SIZE } from '../src/domain/usecases/admin/RunUserDeletion.js';
import { ANA, createTestEnvironment, seed, signedIn, task } from './helpers.js';

const ADMIN = { uid: 'uid-admin', email: 'admin@example.com' };
const INES = { uid: 'uid-ines', email: 'ines@example.com' }; // en eliminación
const MAX = 30;

let env;

beforeAll(async () => {
  env = await createTestEnvironment();
  await env.clearFirestore();
  await seed(env, {
    'allowedUsers/ana@example.com': { name: 'Ana' },
    'allowedUsers/admin@example.com': { name: 'Admin', role: 'admin', active: true, uid: ADMIN.uid },
    'deletions/uid-ines': { state: 'deleting', taskCount: 0, backupAt: Date.now(), backupHash: 'huella-ficticia' },
  });
});

afterAll(() => env?.cleanup());

const ids = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

// Crea o borra las tareas con su índice en un lote, como FirestoreTaskRepository y deleteTaskChunk.
function writePairs(db, taskIds, ownerId, { remove = false } = {}) {
  const batch = writeBatch(db);
  taskIds.forEach((id) => {
    if (remove) {
      batch.delete(doc(db, `tasks/${id}`));
      batch.delete(doc(db, `taskIndex/${id}`));
    } else {
      batch.set(doc(db, `tasks/${id}`), task(ownerId));
      batch.set(doc(db, `taskIndex/${id}`), { ownerId });
    }
  });
  return batch.commit();
}

// Tareas de Inés con su índice, escritas sin reglas en un solo lote.
function seedPairs(taskIds) {
  return env.withSecurityRulesDisabled((context) => writePairs(context.firestore(), taskIds, INES.uid));
}

// Mayor número de tareas (con su índice) por lote que las reglas aceptan, probando de 1 a MAX.
async function largestAccepted(write) {
  let largest = 0;
  for (let count = 1; count <= MAX; count++) {
    try {
      await write(count);
      largest = count;
    } catch {
      break;
    }
  }
  return largest;
}

// Medido el 31 de octubre de 2026 con firebase-tools 15.33.0 y las reglas estrictas: el emulador aceptó
// las 30 tareas por lote en los dos casos (más de 60 llamadas), así que no aplica el límite de 20 de
// producción. Los trozos se quedan en 8 según la documentación (17 y 18 llamadas) y el límite real se
// comprueba en Desarrollo al publicar estas reglas (VERIFICACION_MANUAL.md, 7.5).
describe('P-20 llamadas por lote en el emulador, con las reglas estrictas', () => {
  it(`el dueño crea y borra ${TASK_CHUNK_SIZE} tareas con su índice por lote`, async () => {
    const db = signedIn(env, ANA);
    await assertSucceeds(writePairs(db, ids('trozo', TASK_CHUNK_SIZE), ANA.uid));
    await assertSucceeds(writePairs(db, ids('trozo', TASK_CHUNK_SIZE), ANA.uid, { remove: true }));

    const largest = await largestAccepted((count) => writePairs(db, ids(`lote-${count}`, count), ANA.uid));
    console.info(`Dueño: ${largest} tareas con su índice por lote (trozo usado: ${TASK_CHUNK_SIZE}).`);
    expect(largest).toBeGreaterThanOrEqual(TASK_CHUNK_SIZE);
  });

  it(`el administrador borra ${DELETION_CHUNK_SIZE} tareas con su índice de una persona en eliminación`, async () => {
    const db = signedIn(env, ADMIN);
    await seedPairs(ids('ines-trozo', DELETION_CHUNK_SIZE));
    await assertSucceeds(writePairs(db, ids('ines-trozo', DELETION_CHUNK_SIZE), INES.uid, { remove: true }));

    const largest = await largestAccepted(async (count) => {
      await seedPairs(ids(`ines-lote-${count}`, count));
      await writePairs(db, ids(`ines-lote-${count}`, count), INES.uid, { remove: true });
    });
    console.info(`Administrador: ${largest} tareas con su índice por lote (trozo usado: ${DELETION_CHUNK_SIZE}).`);
    expect(largest).toBeGreaterThanOrEqual(DELETION_CHUNK_SIZE);
  });
});
