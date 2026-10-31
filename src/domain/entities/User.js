// Persona autorizada en LUCAS: su documento de allowedUsers (id = correo en minúsculas). Rol,
// estado y uid son opcionales y se interpretan igual que en firestore.rules
// (docs/PLAN_USUARIOS.md, 1.2): un documento de antes de los roles (solo name) es un miembro activo.

export const ROLES = ['admin', 'member'];

/**
 * @typedef {object} AllowedUser
 * @property {string} email Correo en minúsculas (id del documento).
 * @property {string} name
 * @property {'admin' | 'member'} role
 * @property {boolean} active
 * @property {string | null} uid null si la persona nunca ha entrado.
 * @property {Record<string, unknown>} permissions Permisos por función (sección 3 del plan); vacío si no hay.
 * @property {boolean} deleting true si la persona está en eliminación (marca deleting, sección 2.2).
 * @property {string | null} doneLogId ID de la entrada delete-done que se escribe al terminar la
 *   eliminación (deleting.doneLogId, generado al confirmarla); null si no está en eliminación.
 */

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Solo el texto exacto 'admin' da el rol y solo true (o ningún valor) deja activa a la persona:
 * un dato corrupto niega, nunca concede.
 * @param {string} email
 * @param {Record<string, unknown>} data
 * @returns {AllowedUser}
 */
export function userFromData(email, data) {
  return {
    email,
    name: typeof data.name === 'string' ? data.name.trim() : '',
    role: data.role === 'admin' ? 'admin' : 'member',
    active: !('active' in data) || data.active === true,
    uid: typeof data.uid === 'string' && data.uid !== '' ? data.uid : null,
    permissions: isMap(data.permissions) ? data.permissions : {},
    deleting: isMap(data.deleting),
    doneLogId: isMap(data.deleting) && typeof data.deleting.doneLogId === 'string' ? data.deleting.doneLogId : null,
  };
}

/* ---------- Marcador de eliminación (deletions/{clave}, sección 2.2) ---------- */

/**
 * Lo crea solo el script administrativo tras un respaldo verificado; la app lo confirma o lo quita.
 * @typedef {object} DeletionMarker
 * @property {string} key ID del documento: el uid de la persona o, si nunca entró, su correo.
 * @property {'backup-ready' | 'deleting'} state
 * @property {number} taskCount Tareas de la persona en el respaldo.
 * @property {number} backupAt Cuándo terminó el respaldo verificado (ms).
 */

/**
 * Clave del marcador de una persona: su uid o, si nunca ha entrado, su correo (como en las reglas).
 * @param {AllowedUser} user
 */
export function deletionKey(user) {
  return user.uid ?? user.email;
}

/**
 * Un marcador con un estado, un número de tareas o una hora que no son los del script no habilita
 * nada: se ignora (null).
 * @param {string} key
 * @param {Record<string, unknown>} data
 * @returns {DeletionMarker | null}
 */
export function markerFromData(key, data) {
  if (data.state !== 'backup-ready' && data.state !== 'deleting') return null;
  if (!Number.isInteger(data.taskCount) || data.taskCount < 0) return null;
  if (typeof data.backupAt !== 'number') return null;
  return { key, state: data.state, taskCount: data.taskCount, backupAt: data.backupAt };
}
