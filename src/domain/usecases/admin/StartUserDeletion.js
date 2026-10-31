// Confirmar la eliminación de otra persona (docs/PLAN_USUARIOS.md, 2.4 flujo 5 y 2.5 paso 4): exige
// que esté desactivada, sin rol de administrador, con un respaldo verificado de menos de 24 horas
// y que el correo escrito sea el suyo. En un solo lote pasa el marcador a 'deleting', marca a la
// persona y escribe la entrada delete-start; guarda además el ID de la entrada delete-done con la
// que se cerrará la eliminación, aunque se reanude en otra sesión.
import { buildLogEntry } from '../../entities/AdminLog.js';
import { deletionKey } from '../../entities/User.js';
import { canChangeUser, isBackupFresh, matchesEmail } from '../../rules/permissions.js';

/**
 * @typedef {'no-backup' | 'backup-stale' | 'email-mismatch'} StartRejection
 */

/**
 * @param {import('../../entities/User.js').AllowedUser & { uid: string }} actor
 * @param {import('../../entities/User.js').AllowedUser} target
 * @param {object} input
 * @param {import('../../entities/User.js').DeletionMarker | null} input.marker Marcador de la persona.
 * @param {string} input.confirmation Correo que escribió el administrador.
 * @param {import('./changeUser.js').AdminDeps & { now?: number }} deps
 * @returns {Promise<{ ok: true, doneLogId: string }
 *   | { ok: false, reason: import('../../rules/permissions.js').ChangeRejection | StartRejection }>}
 */
export async function startUserDeletion(
  actor,
  target,
  { marker, confirmation },
  { adminUsers, newId, now = Date.now() },
) {
  const check = canChangeUser(actor, target, { type: 'delete' });
  if (!check.ok) return check;
  if (marker?.key !== deletionKey(target) || marker.state !== 'backup-ready') return { ok: false, reason: 'no-backup' };
  if (!isBackupFresh(marker, now)) return { ok: false, reason: 'backup-stale' };
  if (!matchesEmail(confirmation, target.email)) return { ok: false, reason: 'email-mismatch' };

  const detail = { taskCount: marker.taskCount };
  const entry = { id: newId(), ...buildLogEntry('delete-start', actor.uid, target.uid, detail) };
  const doneLogId = newId();
  await adminUsers.startDeletion(target.email, marker.key, entry, doneLogId);
  return { ok: true, doneLogId };
}
