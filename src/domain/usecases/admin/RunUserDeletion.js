// Borrar los datos de una persona con la eliminación confirmada (docs/PLAN_USUARIOS.md, 2.5 pasos 5
// a 7): sus tareas por trozos, elegidas por el índice y sin leerlas; después lo comprueba contra el
// número de tareas del respaldo y, si cuadra, borra su documento y su marcador con la entrada
// delete-done. Se puede repetir desde donde quedó. Las reglas no dejan guardar el avance en el
// marcador, así que lo ya borrado se calcula como taskCount menos los índices que quedan.
import { buildLogEntry } from '../../entities/AdminLog.js';
import { deletionKey } from '../../entities/User.js';

// Tareas por lote, como TASK_CHUNK_SIZE de la capa de datos: cabe en el presupuesto de llamadas
// de las reglas por lote (2.6 y 2.9).
export const DELETION_CHUNK_SIZE = 8;

/**
 * @typedef {{ done: number, total: number }} DeletionProgress Tareas borradas de las del respaldo.
 * @typedef {'not-admin' | 'self' | 'not-confirmed' | 'leftovers'} RunRejection leftovers: quedan datos
 *   que no cuadran con el respaldo; hay que limpiarlos con el script antes de terminar.
 */

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target Persona con la marca de eliminación.
 * @param {import('../../entities/User.js').DeletionMarker | null} marker Su marcador, en 'deleting'.
 * @param {object} deps
 * @param {import('../../repositories/AdminUsersRepository.js').AdminUsersRepository} deps.adminUsers
 * @param {(progress: DeletionProgress) => void} [deps.onProgress] Avance tras cada trozo.
 * @returns {Promise<{ ok: true, total: number } | { ok: false, reason: RunRejection }>}
 */
export async function runUserDeletion(actor, target, marker, { adminUsers, onProgress = () => {} }) {
  if (actor.role !== 'admin' || !actor.active) return { ok: false, reason: 'not-admin' };
  if (actor.email === target.email) return { ok: false, reason: 'self' };
  if (!target.deleting || !target.doneLogId || marker?.key !== deletionKey(target) || marker.state !== 'deleting') {
    return { ok: false, reason: 'not-confirmed' };
  }

  const total = marker.taskCount;
  if (target.uid) {
    // Más índices que tareas respaldadas: hay tareas que el respaldo no tiene. No se borra nada.
    const remaining = await adminUsers.countIndexed(target.uid);
    if (remaining > total) return { ok: false, reason: 'leftovers' };

    let done = total - remaining;
    onProgress({ done, total });
    for (;;) {
      const { deleted } = await adminUsers.deleteTaskChunk(target.uid, DELETION_CHUNK_SIZE);
      if (deleted === 0) break;
      done += deleted;
      onProgress({ done: Math.min(done, total), total });
    }
    // Cierre: lo borrado cuadra con el respaldo y el servidor ya no tiene índices de la persona.
    if (done !== total || (await adminUsers.countIndexed(target.uid)) !== 0) return { ok: false, reason: 'leftovers' };
  } else if (total !== 0) {
    // Quien nunca entró no tiene uid ni tareas: el script deja su marcador con taskCount 0.
    return { ok: false, reason: 'leftovers' };
  }

  const entry = { id: target.doneLogId, ...buildLogEntry('delete-done', actor.uid, target.uid, { taskCount: total }) };
  await adminUsers.finishDeletion(target.email, marker.key, entry);
  return { ok: true, total };
}
