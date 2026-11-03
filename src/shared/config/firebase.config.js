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
 * @property {{ auth: string, firestore: { host: string, port: number } }} [emulators] Solo en el ambiente
 *   de las pruebas end-to-end: data/datasources/firebase.init.js se conecta a los emuladores.
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

// Hosts donde puede usarse el ambiente de los emuladores (las pruebas de Playwright sirven la app en local).
export const EMULATOR_HOSTS = ['localhost', '127.0.0.1'];

// Ambiente de las pruebas end-to-end (docs/PLAN_AMBIENTES.md, E.2 y P-9): una copia de Desarrollo contra los
// emuladores, con el proyecto ficticio demo-lucas. Solo existe con vite --mode e2e: Vite cambia
// import.meta.env.MODE por un literal, así que en el build de despliegue (production) la condición es falsa y
// el objeto, con su proyecto y sus puertos, no llega al bundle (deploy.yml lo comprueba). No está en
// ENVIRONMENTS. Se escribe con import.meta.env.MODE (no con env.MODE) para que Vite pueda sustituirlo.
/** @type {AppEnvironment | null} */
export const EMULATOR_ENVIRONMENT =
  import.meta.env.MODE === 'e2e'
    ? {
        name: 'dev',
        storageKey: 'tareas-e2e',
        migratedKey: 'tareas-migradas-e2e',
        firebaseConfig: {
          apiKey: 'demo-api-key',
          authDomain: 'localhost',
          projectId: 'demo-lucas',
          storageBucket: '',
          messagingSenderId: '',
          appId: '',
        },
        emulators: { auth: 'http://localhost:9099', firestore: { host: 'localhost', port: 8180 } },
      }
    : null;

/**
 * Ambiente que corresponde a una dirección: PDN solo en los dominios de PDN_HOSTS, QA solo en los de
 * QA_HOSTS y Desarrollo en cualquier otra. El de los emuladores, solo si existe (modo e2e) y además la
 * dirección es local: en los hosts de QA y PDN nunca se usa.
 * @param {string} hostname
 * @param {AppEnvironment | null} [emulator]
 * @returns {AppEnvironment}
 */
export function selectEnvironment(hostname, emulator = EMULATOR_ENVIRONMENT) {
  if (PDN_HOSTS.includes(hostname)) return ENVIRONMENTS.pdn;
  if (QA_HOSTS.includes(hostname)) return ENVIRONMENTS.qa;
  if (emulator && EMULATOR_HOSTS.includes(hostname)) return emulator;
  return ENVIRONMENTS.dev;
}

export const APP_ENV = selectEnvironment(window.location.hostname);
