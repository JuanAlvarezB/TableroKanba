// Contrato de la gestión de usuarios del administrador (docs/PLAN_USUARIOS.md, 2.8). La capa de
// datos lo implementa sobre Firestore (data/repositories/AdminUsersRepository.js). Cada cambio se
// escribe junto con su entrada del registro, en la misma operación: si la entrada no se escribe,
// el cambio tampoco (las reglas lo exigen). La eliminación en dos fases (2.5) borra las tareas por
// el índice taskIndex, sin leerlas.

/**
 * @typedef {import('../entities/User.js').AllowedUser} AllowedUser
 * @typedef {import('../entities/User.js').DeletionMarker} DeletionMarker
 * @typedef {import('../entities/AdminLog.js').NewLogEntry} NewLogEntry
 *
 * @typedef {object} AdminUsersRepository
 * @property {(onChange: (users: AllowedUser[]) => void, onError: (error: Error) => void) => () => void} watch
 *   Escucha la lista de personas autorizadas (allowedUsers); devuelve la función para dejar de escuchar.
 * @property {(onChange: (markers: DeletionMarker[]) => void, onError: (error: Error) => void) => () => void} watchDeletions
 *   Escucha los marcadores de eliminación (deletions) que deja el script tras el respaldo; los mal
 *   formados no llegan.
 * @property {(user: { email: string, name: string, role: 'admin' | 'member' }, entry: NewLogEntry) => Promise<void>} create
 *   Autoriza un correo nuevo, activo y con lastChange = entry.id, junto con su entrada. Comprueba en la
 *   misma transacción que el correo no exista: si existe no lo sobrescribe y lanza
 *   RepositoryError('already-exists').
 * @property {(email: string, fields: { role?: 'admin' | 'member', active?: boolean }, entry: NewLogEntry) => Promise<void>} update
 *   Cambia esos campos de otra persona, con lastChange = entry.id, y escribe la entrada en el mismo lote.
 * @property {(email: string, key: string, entry: NewLogEntry, doneLogId: string) => Promise<void>} startDeletion
 *   Confirma la eliminación en un lote: el marcador pasa a 'deleting', la persona recibe
 *   deleting = { at, doneLogId } con lastChange = entry.id, y se escribe la entrada delete-start.
 * @property {(key: string, entry: NewLogEntry) => Promise<void>} cancelDeletion
 *   Borra un marcador sin confirmar y escribe la entrada delete-cancel, en el mismo lote.
 * @property {(uid: string) => Promise<number>} countIndexed
 *   Documentos de taskIndex de esa persona, contados en el servidor.
 * @property {(uid: string, limit: number) => Promise<{ deleted: number }>} deleteTaskChunk
 *   Borra en un lote hasta limit tareas de esa persona con su documento de índice, elegidas por el
 *   índice (sin leer las tareas). deleted = 0 cuando ya no quedan índices.
 * @property {(email: string, key: string, entry: NewLogEntry) => Promise<void>} finishDeletion
 *   Termina la eliminación en un lote: borra el documento de la persona y su marcador y escribe la
 *   entrada delete-done (entry.id = deleting.doneLogId).
 *
 * Los fallos de infraestructura llegan como RepositoryError ('permission-denied', 'not-found' o
 * 'unavailable').
 */

export {};
