// Reactivar a otra persona (2.4, flujo 3). No se puede si está en eliminación.
import { changeUser } from './changeUser.js';

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {import('./changeUser.js').AdminDeps} deps
 * @returns {Promise<import('./changeUser.js').ChangeResult>}
 */
export function reactivateUser(actor, target, deps) {
  return changeUser(actor, target, { type: 'reactivate', fields: { active: true }, action: 'reactivate' }, deps);
}
