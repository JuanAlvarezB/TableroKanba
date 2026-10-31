// Punto de entrada de la gestión de usuarios (usuarios.html): crea el store y la vista, exige una
// sesión de administrador y entonces escucha la lista de personas. Quien no es administrador (o
// está sin conexión) vuelve al inicio sin ver nada (docs/PLAN_USUARIOS.md, 2.10).
import { createAdminUsersRepository } from '../../../data/repositories/AdminUsersRepository.js';
import { APP_ENV } from '../../../shared/config/firebase.config.js';
import { mountAccountMenu } from '../../components/AccountMenu.js';
import { ENV_FEATURE_DEFAULTS, onSignOut, requireSession, revalidateSession } from '../../guards/session.js';
import { createUsersStore } from '../../state/usersStore.js';
import { createUsersPage } from './UsersPage.js';

const store = createUsersStore({ defaults: ENV_FEATURE_DEFAULTS });
createUsersPage({ store });

async function startUsers() {
  const session = await requireSession({ role: 'admin' });
  mountAccountMenu(session, document.getElementById('account'));

  store.connect(createAdminUsersRepository(session.firebase), session);
  // Al cerrar la sesión se deja de escuchar la lista.
  onSignOut(() => store.disconnect());
  // Si las reglas rechazan un cambio, quizá ya no es administrador: la guardia lo comprueba.
  store.on('access-lost', revalidateSession);

  // Fuera de PDN se marca la página como Desarrollo.
  if (APP_ENV.name === 'dev') {
    document.title = `[DEV] ${document.title}`;
    document.getElementById('env-badge').hidden = false;
  }
}

startUsers();
