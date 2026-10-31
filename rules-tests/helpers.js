// Ayudante de las pruebas de firestore.rules con el Firebase Emulator Suite (docs/PLAN_USUARIOS.md, 1.8).
// Solo corre contra el emulador local y un proyecto ficticio demo-…: sin claves, sin credenciales y
// sin conexión con Desarrollo ni PDN. Se lanza con npm run test:rules.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';

const RULES = resolve(import.meta.dirname, '..', 'firestore.rules');

// firebase emulators:exec define las dos variables. Si falta alguna, o el proyecto no es ficticio,
// las pruebas se detienen antes de abrir ninguna conexión.
function assertSafeEnvironment() {
  const projectId = process.env.GCLOUD_PROJECT ?? '';
  if (!projectId.startsWith('demo-')) {
    throw new Error(`Las pruebas de reglas solo corren con un proyecto demo-… (recibido: "${projectId}").`);
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('No hay emulador de Firestore activo: usa npm run test:rules.');
  }
  return projectId;
}

/** Texto de firestore.rules. */
export function readRules() {
  return readFileSync(RULES, 'utf-8');
}

/**
 * Entorno de pruebas con las reglas de firestore.rules cargadas en el emulador, u otras (por ejemplo,
 * las anteriores a un cambio). Las reglas valen para todo el emulador hasta que otro entorno cargue
 * las suyas.
 */
export function createTestEnvironment({ rules = readRules() } = {}) {
  return initializeTestEnvironment({
    projectId: assertSafeEnvironment(),
    firestore: { rules },
  });
}

// Personas ficticias: correos de example.com (dominio reservado) y uids inventados.
export const ANA = { uid: 'uid-ana', email: 'ana@example.com' };
export const BETO = { uid: 'uid-beto', email: 'beto@example.com' };

/** Sesión con correo; por defecto verificado, como exigen las reglas. */
export function signedIn(env, { uid, email }, { verified = true } = {}) {
  return env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}

/** Tarea válida según isValidTask, del dueño indicado. */
export function task(ownerId, fields = {}) {
  return {
    text: 'Tarea de prueba',
    status: 'pending',
    order: 0,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
    priority: null,
    dueDate: null,
    ownerId,
    ...fields,
  };
}

// La tarea y su documento de taskIndex van siempre en el mismo lote, como en FirestoreTaskRepository
// (docs/PLAN_USUARIOS.md, 2.6): así las pruebas valen con las reglas de transición y con las estrictas.

/** Crea (o reemplaza) la tarea con su índice en un solo lote. */
export function saveTask(db, id, data) {
  const batch = writeBatch(db);
  batch.set(doc(db, `tasks/${id}`), data);
  batch.set(doc(db, `taskIndex/${id}`), { ownerId: data.ownerId });
  return batch.commit();
}

/** Borra la tarea y su índice en un solo lote. */
export function removeTask(db, id) {
  const batch = writeBatch(db);
  batch.delete(doc(db, `tasks/${id}`));
  batch.delete(doc(db, `taskIndex/${id}`));
  return batch.commit();
}

/** Tarea con su índice, para seed(): { 'tasks/id': datos, 'taskIndex/id': { ownerId } }. */
export function indexedTask(id, data) {
  return { [`tasks/${id}`]: data, [`taskIndex/${id}`]: { ownerId: data.ownerId } };
}

/** Escribe documentos con las reglas desactivadas: { 'ruta/del/doc': datos }. */
export function seed(env, documents) {
  return env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [path, data] of Object.entries(documents)) await setDoc(doc(db, path), data);
  });
}
