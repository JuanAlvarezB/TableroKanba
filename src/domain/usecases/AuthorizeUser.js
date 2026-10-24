// Decide si una persona con sesión puede entrar en LUCAS: tiene que estar en la lista de
// autorizados, activa y con el correo verificado. Sin conexión vale su última autorización
// confirmada en este navegador, durante un plazo y siempre como miembro (docs/PLAN_USUARIOS.md, 1.3 y 1.4).
import { claimUid } from './ClaimUid.js';

// Plazo para entrar sin conexión desde la última autorización confirmada (alarma A-8).
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {{ status: 'ok', name: string, role: 'admin' | 'member', permissions: Record<string, unknown>,
 *     offline?: boolean, claimError?: unknown }
 *   | { status: 'denied' } | { status: 'inactive' } | { status: 'unverified' }
 *   | { status: 'offline', error: unknown }} Authorization
 *
 * @param {import('../entities/Session.js').AuthUser} user
 * @param {object} deps
 * @param {import('../repositories/AuthRepository.js').AllowedUsersRepository} deps.allowedUsers
 * @param {import('../repositories/AuthRepository.js').SessionStore} deps.sessionStore
 * @param {number} [deps.now] Hora actual en milisegundos.
 * @returns {Promise<Authorization>}
 */
export async function authorizeUser(user, { allowedUsers, sessionStore, now = Date.now() }) {
  const email = (user.email ?? '').toLowerCase();
  if (user.isAnonymous || !email) return { status: 'denied' };

  let allowed;
  try {
    allowed = await allowedUsers.find(email);
  } catch (error) {
    if (error.reason === 'permission-denied') return { status: 'denied' };
    return offlineAuthorization(user.uid, sessionStore, now) ?? { status: 'offline', error };
  }

  if (!allowed) {
    sessionStore.forget(user.uid);
    return { status: 'denied' };
  }
  // Antes que la verificación: no tiene sentido pedir verificar un correo que no dará acceso.
  if (!allowed.active) {
    sessionStore.forget(user.uid);
    return { status: 'inactive' };
  }
  if (!user.emailVerified) return { status: 'unverified' };
  // Otro uid registrado: la cuenta se recreó en Authentication (alarma A-9). No se sobrescribe; se
  // corrige en la consola.
  if (allowed.uid && allowed.uid !== user.uid) return { status: 'denied' };

  sessionStore.remember(user.uid, allowed.name, now);
  sessionStore.clearLegacy();
  const claim = await claimUid(user, allowed, { allowedUsers });
  return {
    status: 'ok',
    name: allowed.name,
    role: allowed.role,
    permissions: allowed.permissions,
    ...(claim.status === 'failed' && { claimError: claim.error }),
  };
}

// Las autorizaciones recordadas antes de guardar la hora (sin `at`) se aceptan hasta la siguiente
// conexión, que las reescribe con hora.
function offlineAuthorization(uid, sessionStore, now) {
  const remembered = sessionStore.remembered(uid);
  if (!remembered) return null;
  if (typeof remembered.at === 'number' && now - remembered.at > OFFLINE_GRACE_MS) return null;
  return { status: 'ok', name: remembered.name, role: 'member', permissions: {}, offline: true };
}
