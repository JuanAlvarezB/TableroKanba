// Sube una sola vez las tareas que la persona tenía guardadas solo en este navegador, a su
// nombre en el repositorio remoto.

/**
 * @param {object} deps
 * @param {import('../entities/Task.js').Task[]} deps.tasks Tareas de la copia local.
 * @param {{ isMigrated: () => boolean, markMigrated: () => void }} deps.cache
 * @param {import('../repositories/TaskRepository.js').TaskRepository} deps.repository
 * @returns {Promise<boolean>} true si se subieron tareas.
 */
export async function migrateLocalTasks({ tasks, cache, repository }) {
  if (cache.isMigrated() || tasks.length === 0) return false;
  await repository.saveAll(tasks);
  cache.markMigrated();
  return true;
}
