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
  };
}
