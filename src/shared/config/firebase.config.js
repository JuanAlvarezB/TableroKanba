// Configuración de Firebase por ambiente. Es pública por diseño: los datos los protegen
// las reglas de Firestore. Los valores vienen de las variables VITE_FIREBASE_* (.env.local en
// local, variables del repositorio en GitHub Actions; ver .env.example).
//
// Solo el dominio de GitHub Pages usa PDN; cualquier otra dirección (localhost, vite
// preview…) usa Desarrollo, para que un error de configuración nunca escriba datos de prueba
// en PDN. Por eso la elección depende de la dirección de la página y no del modo de Vite.
export const PDN_HOSTS = ['juanalvarezb.github.io'];

const env = import.meta.env;

/**
 * @typedef {object} AppEnvironment
 * @property {'pdn' | 'dev'} name
 * @property {string} storageKey Prefijo de las claves de localStorage de las tareas.
 * @property {string} migratedKey Prefijo de la marca de tareas locales ya subidas.
 * @property {import('firebase/app').FirebaseOptions} firebaseConfig
 */

/** @type {{ pdn: AppEnvironment, dev: AppEnvironment }} */
export const ENVIRONMENTS = {
  pdn: {
    name: 'pdn',
    // Claves de localStorage sin cambio: así PDN conserva las tareas guardadas en cada navegador.
    storageKey: 'tareas',
    migratedKey: 'tareas-migradas',
    firebaseConfig: {
      apiKey: env.VITE_FIREBASE_PDN_API_KEY,
      authDomain: env.VITE_FIREBASE_PDN_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PDN_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_PDN_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_PDN_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_PDN_APP_ID,
    },
  },
  dev: {
    name: 'dev',
    // Claves propias: las tareas de un ambiente nunca se suben al otro (migrateLocalTasks).
    storageKey: 'tareas-dev',
    migratedKey: 'tareas-migradas-dev',
    firebaseConfig: {
      apiKey: env.VITE_FIREBASE_DEV_API_KEY,
      authDomain: env.VITE_FIREBASE_DEV_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_DEV_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_DEV_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_DEV_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_DEV_APP_ID,
    },
  },
};

/**
 * Ambiente que corresponde a una dirección: PDN solo en los dominios de PDN_HOSTS.
 * @param {string} hostname
 * @returns {AppEnvironment}
 */
export function selectEnvironment(hostname) {
  return PDN_HOSTS.includes(hostname) ? ENVIRONMENTS.pdn : ENVIRONMENTS.dev;
}

export const APP_ENV = selectEnvironment(window.location.hostname);
