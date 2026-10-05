// Punto de entrada del inicio de LUCAS (index.html): exige sesión, saluda y muestra las
// funciones disponibles.
import { APP_ENV } from '../../../shared/config/firebase.config.js';
import { mountAccountMenu } from '../../components/AccountMenu.js';
import { requireSession } from '../../guards/session.js';

async function startHome() {
  const session = await requireSession();

  document.getElementById('user-name').textContent = session.name;
  mountAccountMenu(session, document.getElementById('account'));

  // Fuera de PDN se marca la página como Desarrollo.
  if (APP_ENV.name === 'dev') {
    document.title = `[DEV] ${document.title}`;
    document.getElementById('env-badge').hidden = false;
  }
}

startHome();
