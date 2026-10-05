// Contratos de autenticación y autorización. La capa de datos los implementa con Firebase
// Authentication (FirebaseAuthRepository) y la colección allowedUsers de Firestore
// (AllowedUsersRepository). Los errores de autenticación conservan su `code` de Firebase
// ("auth/…"), que shared/constants/messages.js traduce al español.

/**
 * @typedef {import('../entities/Session.js').AuthUser} AuthUser
 *
 * @typedef {object} AuthRepository
 * @property {() => Promise<AuthUser | null>} restore Espera a conocer la sesión guardada y la devuelve.
 * @property {() => AuthUser | null} currentUser Sesión actual (sin esperar).
 * @property {(email: string, password: string) => Promise<AuthUser>} signInWithEmail
 * @property {() => Promise<AuthUser>} signInWithGoogle Abre la ventana de Google: llamar directamente en el clic.
 * @property {(email: string, continueUrl: string) => Promise<void>} sendPasswordReset
 * @property {(user: AuthUser, continueUrl: string) => Promise<void>} sendEmailVerification
 * @property {(user: AuthUser) => Promise<void>} refresh Recarga el usuario (por si verificó el correo en otra pestaña).
 * @property {(user: AuthUser, current: string, next: string) => Promise<void>} changePassword
 * @property {() => Promise<void>} signOut
 * @property {(callback: (user: AuthUser | null) => void) => () => void} onChange
 *
 * @typedef {object} AllowedUsersRepository
 * @property {(email: string) => Promise<{ name: string } | null>} find Persona autorizada, o null si no lo está.
 *   Lanza RepositoryError ('permission-denied' o 'unavailable') si no se pudo comprobar.
 *
 * @typedef {object} SessionStore Lo que el navegador recuerda de cada persona (data/repositories/SessionStore.js).
 * @property {(uid: string) => { tasks: string, migrated: string, authorized: string }} keysFor Claves de localStorage.
 * @property {(uid: string) => { name: string } | null} remembered Última autorización confirmada.
 * @property {(uid: string, name: string) => void} remember
 * @property {(uid: string) => void} forget Borra todo lo de esa persona en este navegador.
 * @property {() => void} clearLegacy Borra las copias del tablero anónimo anterior.
 */

export {};
