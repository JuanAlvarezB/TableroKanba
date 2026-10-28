// Contrato de la gestión de usuarios del administrador (docs/PLAN_USUARIOS.md, 2.8). La capa de
// datos lo implementa sobre Firestore (data/repositories/AdminUsersRepository.js). Cada cambio se
// escribe junto con su entrada del registro, en la misma operación: si la entrada no se escribe,
// el cambio tampoco (las reglas lo exigen). Las operaciones de la eliminación en dos fases llegan
// con ella.

/**
 * @typedef {import('../entities/User.js').AllowedUser} AllowedUser
 * @typedef {import('../entities/AdminLog.js').NewLogEntry} NewLogEntry
 *
 * @typedef {object} AdminUsersRepository
 * @property {(onChange: (users: AllowedUser[]) => void, onError: (error: Error) => void) => () => void} watch
 *   Escucha la lista de personas autorizadas (allowedUsers); devuelve la función para dejar de escuchar.
 * @property {(user: { email: string, name: string, role: 'admin' | 'member' }, entry: NewLogEntry) => Promise<void>} create
 *   Autoriza un correo nuevo, activo y con lastChange = entry.id, junto con su entrada. Comprueba en la
 *   misma transacción que el correo no exista: si existe no lo sobrescribe y lanza
 *   RepositoryError('already-exists').
 * @property {(email: string, fields: { role?: 'admin' | 'member', active?: boolean }, entry: NewLogEntry) => Promise<void>} update
 *   Cambia esos campos de otra persona, con lastChange = entry.id, y escribe la entrada en el mismo lote.
 *
 * Los fallos de infraestructura llegan como RepositoryError ('permission-denied', 'not-found' o
 * 'unavailable').
 */

export {};
