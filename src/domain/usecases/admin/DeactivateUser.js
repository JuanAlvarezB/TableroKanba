// Desactivar a otra persona (2.4, flujo 2): no podrá entrar y sus datos se conservan. Si es
// administradora, deja de serlo en la práctica mientras esté desactivada (su rol no cambia).
import { changeUser } from './changeUser.js';

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {import('./changeUser.js').AdminDeps} deps
 * @returns {Promise<import('./changeUser.js').ChangeResult>}
 */
export function deactivateUser(actor, target, deps) {
  return changeUser(actor, target, { type: 'deactivate', fields: { active: false }, action: 'deactivate' }, deps);
}
