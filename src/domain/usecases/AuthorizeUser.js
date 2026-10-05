// Decide si una persona con sesión puede entrar en LUCAS: tiene que estar en la lista de
// autorizados y haber verificado su correo. Sin conexión vale su última autorización
// confirmada en este navegador.

/**
 * @typedef {{ status: 'ok', name: string, offline?: boolean }
 *   | { status: 'denied' } | { status: 'unverified' } | { status: 'offline', error: unknown }} Authorization
 *
 * @param {import('../entities/Session.js').AuthUser} user
 * @param {object} deps
 * @param {import('../repositories/AuthRepository.js').AllowedUsersRepository} deps.allowedUsers
 * @param {import('../repositories/AuthRepository.js').SessionStore} deps.sessionStore
 * @returns {Promise<Authorization>}
 */
export async function authorizeUser(user, { allowedUsers, sessionStore }) {
  const email = (user.email ?? '').toLowerCase();
  if (user.isAnonymous || !email) return { status: 'denied' };

  let allowed;
  try {
    allowed = await allowedUsers.find(email);
  } catch (error) {
    if (error.reason === 'permission-denied') return { status: 'denied' };
    const remembered = sessionStore.remembered(user.uid);
    if (remembered) return { status: 'ok', name: remembered.name, offline: true };
    return { status: 'offline', error };
  }

  if (!allowed) {
    sessionStore.forget(user.uid);
    return { status: 'denied' };
  }
  if (!user.emailVerified) return { status: 'unverified' };

  sessionStore.remember(user.uid, allowed.name);
  sessionStore.clearLegacy();
  return { status: 'ok', name: allowed.name };
}
