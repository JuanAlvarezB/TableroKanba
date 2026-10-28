// Autorizar un correo (docs/PLAN_USUARIOS.md, 2.4, flujo 1): valida y normaliza los datos y crea el
// documento de allowedUsers con su entrada del registro. Un correo ya autorizado no se sobrescribe.
import { buildLogEntry } from '../../entities/AdminLog.js';
import { validateNewUser } from '../../rules/permissions.js';

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {{ email: string, name: string, role: string }} input Datos del formulario.
 * @param {import('./changeUser.js').AdminDeps} deps
 * @returns {Promise<{ ok: true, email: string } | { ok: false, reason: 'not-admin' | 'self'
 *   | 'already-authorized' | import('../../rules/permissions.js').NewUserRejection }>}
 */
export async function authorizeEmail(actor, input, { adminUsers, newId }) {
  if (actor.role !== 'admin' || !actor.active) return { ok: false, reason: 'not-admin' };
  const valid = validateNewUser(input);
  if (!valid.ok) return valid;
  if (valid.value.email === actor.email) return { ok: false, reason: 'self' };

  // La persona aún no tiene uid: la entrada no se asocia a nadie (2.7). El detalle es solo el rol.
  const entry = { id: newId(), ...buildLogEntry('authorize', actor.uid, null, { role: valid.value.role }) };
  try {
    await adminUsers.create(valid.value, entry);
  } catch (error) {
    if (error?.reason === 'already-exists') return { ok: false, reason: 'already-authorized' };
    throw error;
  }
  return { ok: true, email: valid.value.email };
}
