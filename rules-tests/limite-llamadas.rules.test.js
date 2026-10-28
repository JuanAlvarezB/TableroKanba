// Medición del límite de llamadas get/exists/existsAfter por lote (docs/PLAN_USUARIOS.md, 2.6 y 2.9,
// caso P-20, alarma A-23). Usa unas reglas de prueba con la forma de las reglas estrictas del índice
// (PR 6): cada tarea y cada índice comprueban con existsAfter al otro, y todos leen el mismo documento
// de quien escribe. Comprueba que el trozo de 8 cabe y registra hasta dónde llega el emulador.
import { assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnvironment } from './helpers.js';

// Tamaño del trozo de FirestoreTaskRepository (TASK_CHUNK_SIZE).
const CHUNK = 8;

const PROBE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function caller() {
      return exists(/databases/$(database)/documents/callers/$(request.auth.uid));
    }
    match /tasks/{id} {
      allow create, delete: if caller()
        && existsAfter(/databases/$(database)/documents/taskIndex/$(id)) == (request.method == 'create');
    }
    match /taskIndex/{id} {
      allow create, delete: if caller()
        && existsAfter(/databases/$(database)/documents/tasks/$(id)) == (request.method == 'create');
    }
  }
}`;

let env;

beforeAll(async () => {
  env = await createTestEnvironment({ rules: PROBE_RULES });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'callers/uid-ana'), { ok: true }));
});

afterAll(async () => {
  await env?.cleanup();
  // Deja otra vez las reglas de firestore.rules en el emulador.
  await (await createTestEnvironment()).cleanup();
});

function createPairs(db, prefix, count) {
  const batch = writeBatch(db);
  for (let i = 0; i < count; i++) {
    batch.set(doc(db, `tasks/${prefix}-${i}`), { ownerId: 'uid-ana' });
    batch.set(doc(db, `taskIndex/${prefix}-${i}`), { ownerId: 'uid-ana' });
  }
  return batch.commit();
}

// Mayor número de tareas (con su índice) que las reglas aceptan en un lote, probando de 1 a max.
async function largestAcceptedBatch(db, max) {
  let largest = 0;
  for (let count = 1; count <= max; count++) {
    try {
      await createPairs(db, `lote-${count}`, count);
      largest = count;
    } catch {
      break;
    }
  }
  return largest;
}

describe('P-20 llamadas por lote en el emulador', () => {
  it(`un trozo de ${CHUNK} tareas con su índice cabe`, async () => {
    const db = env.authenticatedContext('uid-ana').firestore();
    await assertSucceeds(createPairs(db, 'trozo', CHUNK));

    const largest = await largestAcceptedBatch(db, 30);
    console.info(`Límite medido: ${largest} tareas con su índice por lote (trozo usado: ${CHUNK}).`);
    // Medido el 27 de octubre de 2026 con firebase-tools 15.33.0: el emulador aceptó las 30 tareas
    // (60 llamadas existsAfter), así que no aplica el límite de 20 llamadas por lote de producción.
    // El trozo se queda en 8 según la documentación (1 + 2 × 8 = 17 ≤ 20) y el límite real se
    // comprueba en Desarrollo al publicar las reglas estrictas (A-23).
    expect(largest).toBeGreaterThanOrEqual(CHUNK);
  });
});
