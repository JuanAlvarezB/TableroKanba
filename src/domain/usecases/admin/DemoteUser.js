// Quitar el rol de administrador a otra persona (2.4, flujo 4); nunca a uno mismo. El registro
// guarda el rol anterior y el nuevo.
import { changeUser } from './changeUser.js';

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {import('./changeUser.js').AdminDeps} deps
 * @returns {Promise<import('./changeUser.js').ChangeResult>}
 */
export function demoteUser(actor, target, deps) {
  return changeUser(
    actor,
    target,
    { type: 'demote', fields: { role: 'member' }, action: 'demote', detail: { from: target.role, to: 'member' } },
    deps,
  );
}
