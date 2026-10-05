// Carga los SDK de Firebase (paquete firebase de npm, en archivos aparte) e inicializa la app
// del ambiente (shared/config/firebase.config.js) una sola vez.
import { APP_ENV } from '../../shared/config/firebase.config.js';

/**
 * @typedef {object} FirebaseConnection
 * @property {import('firebase/app').FirebaseApp} app
 * @property {import('firebase/auth').Auth} auth
 * @property {typeof import('firebase/auth')} authSdk
 * @property {import('firebase/firestore').Firestore} db
 * @property {typeof import('firebase/firestore')} fs
 */

/** @type {Promise<FirebaseConnection> | null} */
let firebase = null;

/** @returns {Promise<FirebaseConnection>} */
export function loadFirebase() {
  if (!firebase) {
    firebase = Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(
      ([appSdk, authSdk, fs]) => {
        const app = appSdk.initializeApp(APP_ENV.firebaseConfig);
        const auth = authSdk.getAuth(app);
        auth.languageCode = 'es';
        return { app, auth, authSdk, db: fs.getFirestore(app), fs };
      },
    );
    // Si no cargó (sin internet, bloqueado), el siguiente intento vuelve a pedirlo.
    firebase.catch(() => {
      firebase = null;
    });
  }
  return firebase;
}
