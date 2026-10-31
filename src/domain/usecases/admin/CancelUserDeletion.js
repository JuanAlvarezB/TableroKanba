// Cancelar una eliminación que aún no se confirmó (docs/PLAN_USUARIOS.md, 2.4 flujo 6): borra el
// marcador del respaldo, con la entrada delete-cancel. No se borra nada de la persona. Una vez
// confirmada (marca deleting) ya no se puede cancelar: solo terminarla.
import { buildLogEntry } from '../../entities/AdminLog.js';
import { deletionKey } from '../../entities/User.js';
import { canChangeUser } from '../../rules/permissions.js';

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {import('../../entities/User.js').DeletionMarker | null} marker Marcador de la persona.
 * @param {import('./changeUser.js').AdminDeps} deps
 * @returns {Promise<{ ok: true } | { ok: false, reason: import('../../rules/permissions.js').ChangeRejection | 'no-backup' }>}
 */
export async function cancelUserDeletion(actor, target, marker, { adminUsers, newId }) {
  const check = canChangeUser(actor, target, { type: 'cancel-delete' });
  if (!check.ok) return check;
  if (marker?.key !== deletionKey(target) || marker.state !== 'backup-ready') return { ok: false, reason: 'no-backup' };

  const entry = { id: newId(), ...buildLogEntry('delete-cancel', actor.uid, target.uid) };
  await adminUsers.cancelDeletion(marker.key, entry);
  return { ok: true };
}
