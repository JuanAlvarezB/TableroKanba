// Configuración de Firebase por ambiente. Es pública por diseño: los datos los protegen
// las reglas de Firestore. Solo el dominio de GitHub Pages usa PDN; cualquier otra
// dirección (localhost, archivo abierto directo…) usa Desarrollo, para que un error de
// configuración nunca escriba datos de prueba en PDN.
const PDN_HOSTS = ['juanalvarezb.github.io'];

const ENVIRONMENTS = {
  pdn: {
    name: 'pdn',
    // Claves de localStorage sin cambio: así PDN conserva las tareas guardadas en cada navegador.
    storageKey: 'tareas',
    migratedKey: 'tareas-migradas',
    firebaseConfig: {
      apiKey: 'AIzaSyDU9ccKPhiLgn1T6QRf-qfpujcNPnVwEfQ',
      authDomain: 'tablero-kanban-76c61.firebaseapp.com',
      projectId: 'tablero-kanban-76c61',
      storageBucket: 'tablero-kanban-76c61.firebasestorage.app',
      messagingSenderId: '141842598240',
      appId: '1:141842598240:web:9c9ab78a96e8fe55e6b605',
    },
  },
  dev: {
    name: 'dev',
    // Claves propias: las tareas de un ambiente nunca se suben al otro (migrateLocalTasks).
    storageKey: 'tareas-dev',
    migratedKey: 'tareas-migradas-dev',
    firebaseConfig: {
      apiKey: 'AIzaSyB-1usfqYgo16tiofZU-0j9X0tMa3FOKXk',
      authDomain: 'tablero-kanban-dev.firebaseapp.com',
      projectId: 'tablero-kanban-dev',
      storageBucket: 'tablero-kanban-dev.firebasestorage.app',
      messagingSenderId: '573731793339',
      appId: '1:573731793339:web:958503f1949a2452f77c9e',
    },
  },
};

const APP_ENV = PDN_HOSTS.includes(window.location.hostname) ? ENVIRONMENTS.pdn : ENVIRONMENTS.dev;
