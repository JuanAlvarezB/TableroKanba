// Sesión de una persona autorizada en LUCAS, tal como la ven las páginas (ver auth.js).

/**
 * @typedef {object} Session
 * @property {string} uid
 * @property {string} email
 * @property {string} name Nombre visible: el de allowedUsers, el de Google o el correo sin dominio.
 * @property {string | null} photoURL
 * @property {boolean} hasPassword true si entra con correo y contraseña (puede cambiarla).
 * @property {boolean} offline true si la autorización se tomó de la última confirmada (sin red).
 * @property {string} storageKey Clave de localStorage de su copia de tareas.
 * @property {string} migratedKey Clave de la marca de tareas locales ya subidas.
 * @property {AuthUser} user Usuario de autenticación (para cambiar la contraseña).
 * @property {object} firebase Conexión con Firebase, para crear los repositorios de la página.
 *
 * @typedef {object} AuthUser Usuario que entrega el servicio de autenticación.
 * @property {string} uid
 * @property {string | null} email
 * @property {boolean} emailVerified
 * @property {boolean} isAnonymous
 * @property {string | null} displayName
 * @property {string | null} photoURL
 * @property {{ providerId: string }[]} providerData
 */

// Nombre visible: el de allowedUsers; si falta, el de Google; si falta, el correo sin dominio.
export function displayName(user, allowedName) {
  return allowedName || user.displayName || user.email.split('@')[0];
}

export function hasPasswordProvider(user) {
  return user.providerData.some((provider) => provider.providerId === 'password');
}
