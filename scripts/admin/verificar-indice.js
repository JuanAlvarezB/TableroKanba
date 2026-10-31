// Comando verificar-indice (PBI-2.10; docs/PLAN_USUARIOS.md, 2.6 y 2.11): compara las tareas del
// ambiente (o de un uid) con taskIndex. Solo lee, y solo identificadores y ownerId. Las reglas estrictas
// del índice (PR 6) se publican cuando termina con 0 tareas sin índice y 0 índices huérfanos.
import { listIds, requireAdmin } from './context.js';
import { indexDiff, isIndexComplete } from './taskIndex.js';

/**
 * Primero el índice y después las tareas: una tarea creada entre las dos lecturas aparece como tarea
 * sin índice (completar-indice reescribe el mismo { ownerId }) y nunca como índice huérfano (A-25).
 * @param {import('./store.js').Store} store
 * @param {string} [uid]
 */
export async function readIndexState(store, uid) {
  const index = await store.listOwners('taskIndex', uid);
  const tasks = await store.listOwners('tasks', uid);
  return { tasks, index, diff: indexDiff(tasks, index) };
}

/** @param {(line: string) => void} log */
export function reportIndexState(log, { tasks, index, diff }, uid) {
  log(`${uid ? `Solo el uid ${uid}. ` : ''}Tareas: ${tasks.length} · documentos de taskIndex: ${index.length}`);
  listIds(log, 'Tareas sin índice', diff.missing);
  listIds(log, 'Índices huérfanos (sin tarea)', diff.orphans);
  listIds(log, 'Índices con un dueño distinto al de su tarea', diff.mismatched);
  if (diff.unowned.length > 0) {
    listIds(log, '⚠ Tareas sin ownerId (nadie puede leerlas; revísalas en la consola)', diff.unowned);
  }
}

/** @param {import('./context.js').CommandContext} context */
export async function verifyIndex({ options, store, log }) {
  await requireAdmin(store, options.admin);
  const state = await readIndexState(store, options.uid);
  reportIndexState(log, state, options.uid);
  if (isIndexComplete(state.diff)) {
    log('✔ Índice completo: 0 tareas sin índice y 0 índices huérfanos.');
    return 0;
  }
  log('✘ El índice no está completo: ejecuta completar-indice.');
  return 1;
}
