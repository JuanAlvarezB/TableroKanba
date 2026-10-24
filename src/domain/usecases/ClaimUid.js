// Registra el uid de la persona en su documento de allowedUsers la primera vez que entra
// (docs/PLAN_USUARIOS.md, 1.3). Si falla no bloquea el acceso: se reintenta en el siguiente.

/**
 * @param {import('../entities/Session.js').AuthUser} user
 * @param {import('../entities/User.js').AllowedUser} allowed
 * @param {{ allowedUsers: import('../repositories/AuthRepository.js').AllowedUsersRepository }} deps
 * @returns {Promise<{ status: 'claimed' | 'skipped' } | { status: 'failed', error: unknown }>}
 */
export async function claimUid(user, allowed, { allowedUsers }) {
  if (allowed.uid) return { status: 'skipped' };
  try {
    await allowedUsers.claimUid(allowed.email, user.uid);
    return { status: 'claimed' };
  } catch (error) {
    return { status: 'failed', error };
  }
}
