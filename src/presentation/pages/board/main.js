// Punto de entrada del tablero (tablero.html): crea el store y la vista, espera a confirmar la
// sesión y entonces abre la copia local y conecta con Firestore.
import { createFirestoreTaskRepository } from '../../../data/repositories/FirestoreTaskRepository.js';
import { createLocalTaskCache } from '../../../data/repositories/LocalTaskCache.js';
import { createReminderStore } from '../../../data/repositories/ReminderStore.js';
import { APP_ENV } from '../../../shared/config/firebase.config.js';
import { mountAccountMenu } from '../../components/AccountMenu.js';
import { applyFeatureVisibility } from '../../components/FeatureVisibility.js';
import { onSignOut, requireSession, revalidateSession } from '../../guards/session.js';
import { createBoardStore } from '../../state/boardStore.js';
import { setFeatures } from '../../state/features.js';
import { createBoardPage } from './BoardPage.js';

// Fuera de PDN se marca la página como Desarrollo, para no confundir las pruebas con el
// tablero real.
function showEnvironmentBadge() {
  if (APP_ENV.name !== 'dev') return;
  document.title = `[DEV] ${document.title}`;
  const badge = document.createElement('span');
  badge.className = 'env-badge';
  badge.textContent = 'DESARROLLO';
  document.querySelector('h1').append(' ', badge);
}

// La vista escucha desde el principio (formulario, arrastre, avisos), pero el tablero queda
// vacío hasta confirmar la sesión.
const store = createBoardStore();
createBoardPage({ store, reminders: createReminderStore() });

// El tablero solo carga tareas después de confirmar la sesión: sin sesión lleva al login, sin
// conexión ni autorización recordada muestra la pantalla de Reintentar, y sin el permiso del tablero
// vuelve al inicio con su aviso (docs/PLAN_USUARIOS.md, 3.4).
async function startBoard() {
  const session = await requireSession({ feature: 'board' });
  // Las funciones hijas apagadas no se muestran (docs/PLAN_USUARIOS.md, 3.4).
  setFeatures(session.features);
  applyFeatureVisibility(document, session);
  mountAccountMenu(session, document.getElementById('account'));

  store.loadLocal(
    createLocalTaskCache({
      tasksKey: session.storageKey,
      migratedKey: session.migratedKey,
      indexKey: session.indexKey,
    }),
  );
  store.connect(createFirestoreTaskRepository(session.firebase, session.uid), { offline: session.offline });
  // Al cerrar la sesión se deja de escuchar y de escribir antes de borrar la copia local.
  onSignOut(() => store.disconnect());
  store.on('access-lost', revalidateSession);
}

showEnvironmentBadge();
startBoard();
