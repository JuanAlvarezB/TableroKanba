// Dar el rol de administrador a otra persona, activa o inactiva (2.4, flujo 4). El registro guarda
// el rol anterior y el nuevo.
import { changeUser } from './changeUser.js';

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {import('./changeUser.js').AdminDeps} deps
 * @returns {Promise<import('./changeUser.js').ChangeResult>}
 */
export function promoteUser(actor, target, deps) {
  return changeUser(
    actor,
    target,
    { type: 'promote', fields: { role: 'admin' }, action: 'promote', detail: { from: target.role, to: 'admin' } },
    deps,
  );
}
