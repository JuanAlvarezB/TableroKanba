// Paso común de los cambios del administrador sobre otra persona (desactivar, reactivar, promover,
// degradar): comprueba la regla del último administrador con el estado actual, escribe el cambio
// con su entrada del registro y no escribe nada si la persona ya está así.
import { buildLogEntry } from '../../entities/AdminLog.js';
import { canChangeUser } from '../../rules/permissions.js';

/**
 * @typedef {import('../../entities/User.js').AllowedUser} AllowedUser
 * @typedef {object} AdminDeps
 * @property {import('../../repositories/AdminUsersRepository.js').AdminUsersRepository} adminUsers
 * @property {() => string} newId ID del documento de la entrada del registro.
 *
 * @typedef {{ ok: true, unchanged?: true }
 *   | { ok: false, reason: import('../../rules/permissions.js').ChangeRejection }} ChangeResult
 */

/**
 * @param {AllowedUser & { uid: string }} actor Administrador con sesión (su uid es el de la sesión).
 * @param {AllowedUser} target
 * @param {object} change
 * @param {import('../../rules/permissions.js').ChangeType} change.type
 * @param {{ role?: 'admin' | 'member', active?: boolean }} change.fields
 * @param {import('../../entities/AdminLog.js').AdminAction} change.action
 * @param {Record<string, string>} [change.detail]
 * @param {AdminDeps} deps
 * @returns {Promise<ChangeResult>}
 */
export async function changeUser(actor, target, { type, fields, action, detail }, { adminUsers, newId }) {
  const check = canChangeUser(actor, target, { type, ...('role' in fields && { role: fields.role }) });
  if (!check.ok) return check;
  // Otro administrador ya lo cambió: no hace falta otra escritura ni otra entrada del registro.
  if (Object.entries(fields).every(([field, value]) => target[field] === value)) return { ok: true, unchanged: true };

  const entry = { id: newId(), ...buildLogEntry(action, actor.uid, target.uid, detail) };
  await adminUsers.update(target.email, fields, entry);
  return { ok: true };
}
