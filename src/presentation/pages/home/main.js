// Punto de entrada del inicio de LUCAS (index.html): exige sesión, saluda y muestra las
// funciones habilitadas para la persona (docs/PLAN_USUARIOS.md, 3.4).
import { APP_ENV } from '../../../shared/config/firebase.config.js';
import { mountAccountMenu } from '../../components/AccountMenu.js';
import { applyFeatureVisibility, showFeatureNotice } from '../../components/FeatureVisibility.js';
import { requireSession, takeHomeMessage } from '../../guards/session.js';

async function startHome() {
  const session = await requireSession();

  document.getElementById('user-name').textContent = session.name;
  mountAccountMenu(session, document.getElementById('account'));
  applyFeatureVisibility(document, session);
  showFeatureNotice(document.getElementById('home-notice'), takeHomeMessage());

  // Fuera de PDN se marca la página como Desarrollo.
  if (APP_ENV.name === 'dev') {
    document.title = `[DEV] ${document.title}`;
    document.getElementById('env-badge').hidden = false;
  }
}

startHome();
