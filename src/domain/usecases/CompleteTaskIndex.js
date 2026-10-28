// Completa el índice de las tareas que ya existían antes de él (docs/PLAN_USUARIOS.md, 2.6, paso 2
// de la transición): crea los documentos de taskIndex que falten y borra los que no tienen tarea.
// Una vez completo se recuerda en el navegador para no repetirlo en cada sesión.

/**
 * @param {object} deps
 * @param {() => import('../entities/Task.js').Task[]} deps.currentTasks Tareas confirmadas por el
 *   servidor. Se piden después de leer el índice, para comparar con lo más reciente.
 * @param {{ isIndexComplete: () => boolean, markIndexComplete: (at: number) => void }} deps.cache
 * @param {import('../repositories/TaskRepository.js').TaskRepository} deps.repository
 * @param {number} deps.now
 * @returns {Promise<{ created: number, removed: number } | null>} null si ya estaba completo.
 */
export async function completeTaskIndex({ currentTasks, cache, repository, now }) {
  if (cache.isIndexComplete()) return null;

  const indexed = new Set(await repository.indexedIds());
  const taskIds = new Set(currentTasks().map((task) => task.id));
  const missing = [...taskIds].filter((id) => !indexed.has(id));
  const orphans = [...indexed].filter((id) => !taskIds.has(id));

  await repository.addToIndex(missing);
  await repository.removeFromIndex(orphans);
  cache.markIndexComplete(now);
  return { created: missing.length, removed: orphans.length };
}
