// Matriz de permisos por estado de acceso (docs/PLAN_USUARIOS.md, 1.6) y regla del último
// administrador. Es la fuente que consulta la interfaz; firestore.rules repite la misma lógica y
// rules-tests/ la comprueba en el emulador.
import { ROLES } from '../entities/User.js';

/** @typedef {'admin' | 'member' | 'inactive' | 'unauthorized'} AccessState */

/** @type {AccessState[]} */
export const ACCESS_STATES = ['admin', 'member', 'inactive', 'unauthorized'];

// Estados que pueden hacer cada acción. Nadie, tampoco el administrador, toca tareas ajenas ni
// cambia su propio rol o estado. Las escrituras sobre otras personas se habilitan con la sección
// 2 del plan (junto con el registro de acciones) y los permisos por función con la sección 3.
const MATRIX = {
  'tasks.own': ['admin', 'member'],
  'tasks.others': [],
  'users.readOwn': ['admin', 'member', 'inactive'],
  'users.claimUid': ['admin', 'member'],
  'users.changeOwn': [],
  'users.readOthers': ['admin'],
  'users.writeOthers': [],
  'users.delete': [],
};

export const ACTIONS = Object.keys(MATRIX);

/**
 * Estado de acceso según el resultado de authorizeUser. Sin conexión nunca se es administrador.
 * @param {import('../usecases/AuthorizeUser.js').Authorization} authorization
 * @returns {AccessState}
 */
export function accessState(authorization) {
  if (authorization.status === 'inactive') return 'inactive';
  if (authorization.status !== 'ok') return 'unauthorized';
  return authorization.role === 'admin' && !authorization.offline ? 'admin' : 'member';
}

/**
 * @param {AccessState} state
 * @param {string} action Una de ACTIONS; cualquier otra se niega.
 */
export function can(state, action) {
  return Object.hasOwn(MATRIX, action) && MATRIX[action].includes(state);
}

/**
 * Un administrador activo puede cambiar el rol o el estado de otra persona, o eliminarla, pero nunca
 * los suyos: así no se puede quedar el sistema sin el último administrador. Límite aceptado: dos
 * administradores que se degradan entre sí a la vez.
 * @param {import('../entities/User.js').AllowedUser} actor
 * @param {import('../entities/User.js').AllowedUser} target
 * @param {{ role?: string, active?: boolean, remove?: boolean }} change
 * @returns {{ ok: true } | { ok: false, reason: 'not-admin' | 'self' | 'unknown-role' }}
 */
export function canChangeUser(actor, target, change) {
  if (actor.role !== 'admin' || !actor.active) return { ok: false, reason: 'not-admin' };
  if (actor.email === target.email) return { ok: false, reason: 'self' };
  if ('role' in change && !ROLES.includes(change.role)) return { ok: false, reason: 'unknown-role' };
  return { ok: true };
}

// Los permisos se comparan sin importar el orden de sus claves.
const sortedEntries = (permissions) => JSON.stringify(Object.entries(permissions).sort());

/**
 * true si cambió el rol o los permisos entre dos autorizaciones de la misma persona: la página
 * abierta debe recargarse para aplicarlos.
 * @param {{ role: string, permissions: Record<string, unknown> }} before
 * @param {{ role: string, permissions: Record<string, unknown> }} after
 */
export function accessChanged(before, after) {
  return before.role !== after.role || sortedEntries(before.permissions) !== sortedEntries(after.permissions);
}
