// Configuración de Firebase por ambiente. Es pública por diseño: los datos los protegen
// las reglas de Firestore. Los valores vienen de las variables VITE_FIREBASE_* (.env.local en
// local, variables del repositorio en GitHub Actions; ver .env.example).
//
// Solo el dominio de GitHub Pages usa PDN y solo los dominios de Hosting de QA usan QA (igualdad
// exacta: nada de subdominios ni sufijos); cualquier otra dirección (localhost, vite preview…) usa
// Desarrollo, para que un error de configuración nunca escriba datos de prueba en QA ni en PDN. Por
// eso la elección depende de la dirección de la página y no del modo de Vite.
export const PDN_HOSTS = ['juanalvarezb.github.io'];
export const QA_HOSTS = ['tablero-kanban-qa.web.app', 'tablero-kanban-qa.firebaseapp.com'];

const env = import.meta.env;

/**
 * @typedef {object} AppEnvironment
 * @property {'pdn' | 'qa' | 'dev'} name
 * @property {string} storageKey Prefijo de las claves de localStorage de las tareas.
 * @property {string} migratedKey Prefijo de la marca de tareas locales ya subidas.
 * @property {{ apiKey: string, authDomain: string, projectId: string, storageBucket: string,
 *   messagingSenderId: string, appId: string }} firebaseConfig Opciones de initializeApp.
 */

/** @type {{ pdn: AppEnvironment, qa: AppEnvironment, dev: AppEnvironment }} */
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
  qa: {
    name: 'qa',
    // Claves propias, como Desarrollo: las tareas de un ambiente nunca se suben a otro.
    storageKey: 'tareas-qa',
    migratedKey: 'tareas-migradas-qa',
    firebaseConfig: {
      apiKey: env.VITE_FIREBASE_QA_API_KEY,
      authDomain: env.VITE_FIREBASE_QA_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_QA_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_QA_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_QA_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_QA_APP_ID,
    },
  },
  dev: {
    name: 'dev',
    // Claves propias: las tareas de un ambiente nunca se suben a otro (migrateLocalTasks).
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
 * Ambiente que corresponde a una dirección: PDN solo en los dominios de PDN_HOSTS, QA solo en los de
 * QA_HOSTS y Desarrollo en cualquier otra.
 * @param {string} hostname
 * @returns {AppEnvironment}
 */
export function selectEnvironment(hostname) {
  if (PDN_HOSTS.includes(hostname)) return ENVIRONMENTS.pdn;
  if (QA_HOSTS.includes(hostname)) return ENVIRONMENTS.qa;
  return ENVIRONMENTS.dev;
}

export const APP_ENV = selectEnvironment(window.location.hostname);
