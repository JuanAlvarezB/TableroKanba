// Vista de la página de usuarios (usuarios.html): dibuja la lista a partir del store y traduce lo
// que hace el administrador (filtros, búsqueda, autorizar y acciones de cada fila) en acciones del
// store. No guarda estado propio salvo los diálogos abiertos.
import { APP_ENV } from '../../../shared/config/firebase.config.js';
import { createConfirmDialogs } from '../../components/ConfirmDialogs.js';
import { createUserForm } from '../../components/UserForm.js';
import { createUserList } from '../../components/UserList.js';
import { plural } from '../../format/labels.js';

const TOAST_DURATION = 3000;

// Consola de Authentication del ambiente actual (Desarrollo o PDN).
function authConsoleUrl() {
  return `https://console.firebase.google.com/project/${APP_ENV.firebaseConfig.projectId}/authentication/users`;
}

/**
 * @param {{ store: ReturnType<typeof import('../../state/usersStore.js').createUsersStore> }} deps
 */
export function createUsersPage({ store }) {
  const status = document.getElementById('users-status');
  const toast = document.getElementById('users-toast');
  const search = document.getElementById('users-search');
  const filterButtons = document.querySelectorAll('.user-filters [data-filter]');
  const authorizeButton = document.getElementById('authorize-open');

  document.getElementById('auth-console-link').href = authConsoleUrl();

  let toastTimeout = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('visible'), TOAST_DURATION);
  }

  const list = createUserList(document.getElementById('user-rows'), {
    onAction: (action, user, opener) => openConfirm(action, user, opener),
  });
  const openConfirm = createConfirmDialogs({
    onConfirm: (action, email) => store.change(action, email),
    restoreFocus: (email) => list.focusActions(email),
  });
  const openUserForm = createUserForm({ onSubmit: (input) => store.authorize(input) });

  function statusText(shown) {
    if (!store.isLoaded()) return 'Cargando personas…';
    if (store.total() === 0) return 'Todavía no hay personas autorizadas.';
    if (shown === 0) return 'Ninguna persona coincide con el filtro o la búsqueda.';
    if (shown === store.total()) return plural(shown, 'persona autorizada', 'personas autorizadas');
    return `${shown} de ${plural(store.total(), 'persona', 'personas')}`;
  }

  function render() {
    const rows = store.rows();
    list.render(rows);
    status.textContent = statusText(rows.length);
    filterButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === store.filter()));
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => store.setFilter(button.dataset.filter));
  });
  search.addEventListener('input', () => store.setQuery(search.value));
  authorizeButton.addEventListener('click', () => openUserForm(authorizeButton));

  store.on('change', render);
  store.on('notice', showToast);
  store.on('error', (message) => {
    status.textContent = message;
  });
}
