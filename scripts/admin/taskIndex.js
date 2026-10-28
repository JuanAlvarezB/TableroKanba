// Comparación entre las tareas y su índice taskIndex (docs/PLAN_USUARIOS.md, 2.6): lógica pura. Solo
// usa identificadores y ownerId; el script nunca pide a Firestore el contenido de las tareas.

/** @typedef {{ id: string, ownerId: unknown }} OwnerRef Identificador y dueño de un documento. */

/**
 * @param {OwnerRef[]} tasks
 * @param {OwnerRef[]} index
 * @returns {{
 *   missing: { id: string, ownerId: string }[],
 *   orphans: { id: string }[],
 *   mismatched: { id: string, ownerId: string }[],
 *   unowned: { id: string }[],
 * }} missing: tareas sin índice; orphans: índices sin tarea; mismatched: índices con otro dueño que
 *   su tarea; unowned: tareas sin ownerId válido (no se pueden indexar).
 */
export function indexDiff(tasks, index) {
  const indexed = new Map(index.map((entry) => [entry.id, entry.ownerId]));
  const taskIds = new Set(tasks.map((task) => task.id));
  const owned = tasks.filter((task) => typeof task.ownerId === 'string' && task.ownerId !== '');
  return {
    missing: owned.filter((task) => !indexed.has(task.id)).map(({ id, ownerId }) => ({ id, ownerId })),
    orphans: index.filter((entry) => !taskIds.has(entry.id)).map(({ id }) => ({ id })),
    mismatched: owned
      .filter((task) => indexed.has(task.id) && indexed.get(task.id) !== task.ownerId)
      .map(({ id, ownerId }) => ({ id, ownerId })),
    unowned: tasks.filter((task) => !owned.includes(task)).map(({ id }) => ({ id })),
  };
}

/** true si el índice está completo: ni tareas sin índice ni índices huérfanos o con otro dueño. */
export const isIndexComplete = ({ missing, orphans, mismatched }) =>
  missing.length === 0 && orphans.length === 0 && mismatched.length === 0;

/**
 * Escrituras que dejan el índice completo: crear los que faltan, corregir el dueño y borrar huérfanos.
 * @param {ReturnType<typeof indexDiff>} diff
 * @returns {import('./store.js').WriteOp[]}
 */
export function indexRepairOps({ missing, orphans, mismatched }) {
  return [
    ...[...missing, ...mismatched].map(({ id, ownerId }) => ({
      type: 'set',
      collection: 'taskIndex',
      id,
      data: { ownerId },
    })),
    ...orphans.map(({ id }) => ({ type: 'delete', collection: 'taskIndex', id })),
  ];
}
