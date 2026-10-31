// Cambiar los permisos por función de otra persona (docs/PLAN_USUARIOS.md, 3.6): solo a un miembro, nunca a
// uno mismo ni a un administrador (que tiene siempre todas las funciones). Escribe el mapa nuevo con su entrada
// set-permissions en el mismo lote; la entrada lleva solo las funciones apagadas y encendidas, sin correos ni
// nombres. Cambiar el tablero no reescribe las hijas: se conservan para cuando vuelva a activarse.
import { buildLogEntry } from '../../entities/AdminLog.js';
import { FEATURE_KEYS, applyPermissionChange, featureDefaults, permissionDiff } from '../../rules/features.js';
import { canChangeUser } from '../../rules/permissions.js';

/** @typedef {'unknown-feature' | 'invalid-value'} PermissionsRejection */

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {Record<string, unknown>} changes Valor nuevo de cada función que cambia, por ejemplo { board: false }.
 * @param {import('./changeUser.js').AdminDeps & { defaults?: import('../../rules/features.js').FeatureFlags }} deps
 *   defaults: valores iniciales del ambiente, para saber qué cambia de verdad en una clave aún no guardada.
 * @returns {Promise<{ ok: true, unchanged?: true }
 *   | { ok: false, reason: import('../../rules/permissions.js').ChangeRejection | PermissionsRejection }>}
 */
export async function setUserPermissions(actor, target, changes, { adminUsers, newId, defaults = featureDefaults() }) {
  const check = canChangeUser(actor, target, { type: 'permissions' });
  if (!check.ok) return check;
  const entries = Object.entries(changes);
  if (entries.some(([key]) => !FEATURE_KEYS.includes(key))) return { ok: false, reason: 'unknown-feature' };
  if (entries.some(([, value]) => typeof value !== 'boolean')) return { ok: false, reason: 'invalid-value' };
  const permissions = entries.reduce(
    (stored, [key, value]) => applyPermissionChange(stored, key, value),
    target.permissions,
  );
  const detail = permissionDiff(target.permissions, permissions, defaults);
  // Nada cambia (o otro administrador ya lo cambió): ni escritura ni entrada del registro.
  if (Object.keys(detail).length === 0) return { ok: true, unchanged: true };
  const entry = { id: newId(), ...buildLogEntry('set-permissions', actor.uid, target.uid, detail) };
  await adminUsers.update(target.email, { permissions }, entry);
  return { ok: true };
}
