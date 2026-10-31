// Matriz de permisos por estado de acceso (docs/PLAN_USUARIOS.md, 1.6), regla del último
// administrador y validación de los usuarios que autoriza el administrador (2.8). Es la fuente que
// consulta la interfaz; firestore.rules repite la misma lógica y rules-tests/ la comprueba en el
// emulador.
import { ROLES } from '../entities/User.js';

/** @typedef {'admin' | 'member' | 'inactive' | 'unauthorized'} AccessState */

/** @type {AccessState[]} */
export const ACCESS_STATES = ['admin', 'member', 'inactive', 'unauthorized'];

// Estados que pueden hacer cada acción. Nadie, tampoco el administrador, toca tareas ajenas ni
// cambia su propio rol o estado. El administrador escribe los documentos de otras personas, siempre
// con su entrada del registro, y elimina a otra persona solo con la eliminación en dos fases
// (sección 2); los permisos por función llegan con la sección 3.
const MATRIX = {
  'tasks.own': ['admin', 'member'],
  'tasks.others': [],
  'users.readOwn': ['admin', 'member', 'inactive'],
  'users.claimUid': ['admin', 'member'],
  'users.changeOwn': [],
  'users.readOthers': ['admin'],
  'users.writeOthers': ['admin'],
  'users.delete': ['admin'],
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

/** @typedef {'deactivate' | 'reactivate' | 'promote' | 'demote' | 'delete' | 'cancel-delete'} ChangeType */

/**
 * @typedef {'not-admin' | 'self' | 'unknown-role' | 'in-deletion' | 'target-is-admin' | 'target-active'}
 *   ChangeRejection
 */

/**
 * Un administrador activo puede cambiar el rol o el estado de otra persona, o eliminarla, pero nunca
 * los suyos: así no se puede quedar el sistema sin el último administrador. Límite aceptado: dos
 * administradores que se degradan entre sí a la vez. Una persona en eliminación no admite cambios, y
 * para eliminar a alguien tiene que estar desactivada y sin rol de administrador.
 * @param {import('../entities/User.js').AllowedUser} actor
 * @param {import('../entities/User.js').AllowedUser} target
 * @param {{ type: ChangeType, role?: string }} change
 * @returns {{ ok: true } | { ok: false, reason: ChangeRejection }}
 */
export function canChangeUser(actor, target, change) {
  if (actor.role !== 'admin' || !actor.active) return { ok: false, reason: 'not-admin' };
  if (actor.email === target.email) return { ok: false, reason: 'self' };
  if ('role' in change && !ROLES.includes(change.role)) return { ok: false, reason: 'unknown-role' };
  if (target.deleting) return { ok: false, reason: 'in-deletion' };
  if (change.type === 'delete' && target.role === 'admin') return { ok: false, reason: 'target-is-admin' };
  if (change.type === 'delete' && target.active) return { ok: false, reason: 'target-active' };
  return { ok: true };
}

/** @typedef {'active' | 'inactive' | 'deleting'} Lifecycle */

/**
 * Estado de ciclo de vida que ve el administrador: la marca de eliminación manda sobre active.
 * @param {import('../entities/User.js').AllowedUser} user
 * @returns {Lifecycle}
 */
export function lifecycleOf(user) {
  if (user.deleting) return 'deleting';
  return user.active ? 'active' : 'inactive';
}

/* ---------- Eliminar a una persona (2.5) ---------- */

export const BACKUP_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * El respaldo del marcador tiene menos de 24 horas. Las reglas lo vuelven a comprobar con la hora
 * del servidor al confirmar.
 * @param {import('../entities/User.js').DeletionMarker | null} marker
 * @param {number} now
 */
export function isBackupFresh(marker, now) {
  return Boolean(marker) && now - marker.backupAt < BACKUP_MAX_AGE;
}

/**
 * Segunda confirmación de la eliminación: lo escrito es el correo de la persona (sin espacios
 * alrededor ni mayúsculas, como se guardan los correos).
 * @param {string} typed
 * @param {string} email
 */
export function matchesEmail(typed, email) {
  return normalizeEmail(typed) === email;
}

/* ---------- Autorizar un correo ---------- */

export const NAME_MAX_LENGTH = 100;

// Correo como lo guardan los IDs de allowedUsers: sin espacios alrededor y en minúsculas.
export function normalizeEmail(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase();
}

// Comprobación de forma, no de existencia: algo@dominio.algo, sin espacios ni barras (el correo es
// el ID del documento y Firestore no admite "/" en los IDs).
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

export function isValidEmail(text) {
  return EMAIL_PATTERN.test(text);
}

/** @typedef {'invalid-email' | 'missing-name' | 'name-too-long' | 'unknown-role'} NewUserRejection */

/**
 * Valida y normaliza los datos del formulario de autorizar (2.4, flujo 1).
 * @param {{ email: string, name: string, role: string }} input
 * @returns {{ ok: true, value: { email: string, name: string, role: 'admin' | 'member' } }
 *   | { ok: false, reason: NewUserRejection }}
 */
export function validateNewUser({ email, name, role }) {
  const value = { email: normalizeEmail(email), name: String(name ?? '').trim(), role };
  if (!isValidEmail(value.email)) return { ok: false, reason: 'invalid-email' };
  if (!value.name) return { ok: false, reason: 'missing-name' };
  if (value.name.length > NAME_MAX_LENGTH) return { ok: false, reason: 'name-too-long' };
  if (!ROLES.includes(role)) return { ok: false, reason: 'unknown-role' };
  return { ok: true, value };
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
