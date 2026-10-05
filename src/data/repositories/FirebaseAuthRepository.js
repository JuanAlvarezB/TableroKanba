// AuthRepository (domain/repositories/AuthRepository.js) sobre Firebase Authentication.

// Errores de Firebase con la dirección de regreso (Dominios autorizados): se reintenta sin ella.
const CONTINUE_URL_ERRORS = [
  'auth/unauthorized-continue-uri',
  'auth/invalid-continue-uri',
  'auth/missing-continue-uri',
];

// Envía un correo de Firebase con regreso a continueUrl; si el dominio no está autorizado para
// la dirección de regreso, lo envía sin ella (el correo llega igual, sin botón "Continuar").
async function sendWithContinueUrl(send, continueUrl) {
  try {
    await send({ url: continueUrl });
  } catch (error) {
    if (!CONTINUE_URL_ERRORS.includes(error.code)) throw error;
    console.warn('Dirección de regreso no autorizada; se envía sin ella:', error);
    await send(undefined);
  }
}

/**
 * @param {import('../datasources/firebase.init.js').FirebaseConnection} firebase
 * @returns {import('../../domain/repositories/AuthRepository.js').AuthRepository}
 */
export function createFirebaseAuthRepository({ auth, authSdk }) {
  return {
    async restore() {
      await auth.authStateReady();
      return auth.currentUser;
    },

    currentUser() {
      return auth.currentUser;
    },

    async signInWithEmail(email, password) {
      const { user } = await authSdk.signInWithEmailAndPassword(auth, email, password);
      return user;
    },

    // La ventana se abre antes del primer await: si se esperara algo antes, el navegador la
    // bloquearía por no venir directamente del clic. Se usa ventana emergente, no redirección,
    // porque el sitio no está en Firebase Hosting (ver docs/PLAN_LOGIN.md, sección 3.4).
    async signInWithGoogle() {
      const provider = new authSdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const { user } = await authSdk.signInWithPopup(auth, provider);
      return user;
    },

    sendPasswordReset(email, continueUrl) {
      return sendWithContinueUrl((settings) => authSdk.sendPasswordResetEmail(auth, email, settings), continueUrl);
    },

    sendEmailVerification(user, continueUrl) {
      return sendWithContinueUrl((settings) => authSdk.sendEmailVerification(user, settings), continueUrl);
    },

    async refresh(user) {
      await user.reload();
      await user.getIdToken(true);
    },

    // Firebase exige un inicio de sesión reciente para cambiar la contraseña: se reautentica
    // siempre con la actual, así nunca aparece auth/requires-recent-login.
    async changePassword(user, current, next) {
      const credential = authSdk.EmailAuthProvider.credential(user.email, current);
      await authSdk.reauthenticateWithCredential(user, credential);
      await authSdk.updatePassword(user, next);
    },

    signOut() {
      return authSdk.signOut(auth);
    },

    onChange(callback) {
      return authSdk.onAuthStateChanged(auth, callback);
    },
  };
}
