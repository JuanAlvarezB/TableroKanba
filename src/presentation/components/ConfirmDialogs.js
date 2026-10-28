// Confirmaciones de la página de usuarios (docs/PLAN_USUARIOS.md, 2.4, flujos 2 a 4): desactivar,
// reactivar, dar y quitar el rol de administrador. Un solo diálogo que cambia de texto según la
// acción. El foco empieza en Cancelar, para que Enter no aplique el cambio sin querer; si el cambio
// falla, el motivo se muestra dentro del diálogo.
import { createButton, createDialog } from './Dialog.js';
import { displayedName } from './UserList.js';

// Texto de cada acción: título, explicación, advertencia (o null), botón y si es destructiva.
const CONFIRMATIONS = {
  deactivate: (user, name) => ({
    title: `¿Desactivar a ${name}?`,
    text: 'No podrá entrar en LUCAS. Sus tareas se conservan y puedes reactivar el acceso cuando quieras.',
    warning: user.role === 'admin' ? 'Es administradora: perderá también ese rol mientras esté desactivada.' : null,
    confirm: 'Desactivar',
    danger: true,
  }),
  reactivate: (user, name) => ({
    title: `¿Reactivar a ${name}?`,
    text: 'Podrá volver a entrar en LUCAS con sus tareas.',
    warning: null,
    confirm: 'Reactivar',
    danger: false,
  }),
  promote: (user, name) => ({
    title: `¿Dar rol de administrador a ${name}?`,
    text: 'Podrá autorizar correos, desactivar o reactivar accesos y gestionar quién es administrador.',
    warning: 'Podrá ver y gestionar usuarios y permisos, pero no las tareas de nadie.',
    confirm: 'Dar rol',
    danger: false,
  }),
  demote: (user, name) => ({
    title: `¿Quitar el rol de administrador a ${name}?`,
    text: 'Seguirá entrando como miembro, con su tablero.',
    warning: null,
    confirm: 'Quitar rol',
    danger: false,
  }),
};

/**
 * @param {object} handlers
 * @param {(action: string, email: string) => Promise<import('../state/usersStore.js').ActionResult>} handlers.onConfirm
 * @param {(email: string) => void} handlers.restoreFocus Devuelve el foco a la fila si la lista se
 *   volvió a dibujar mientras el diálogo estaba abierto (el botón que lo abrió ya no existe).
 * @returns {(action: string, user: import('../../domain/entities/User.js').AllowedUser, opener: HTMLElement) => void}
 */
export function createConfirmDialogs({ onConfirm, restoreFocus }) {
  const { dialog, body, open } = createDialog('confirm-dialog', '');
  dialog.classList.add('users-dialog');
  const title = body.querySelector('.dialog-title');

  const text = document.createElement('p');
  text.className = 'dialog-text';
  const warning = document.createElement('p');
  warning.className = 'users-warn';
  const error = document.createElement('p');
  error.className = 'form-error';
  error.setAttribute('role', 'alert');

  const cancel = createButton('Cancelar', 'dialog-btn', () => dialog.close());
  const confirm = createButton('', 'dialog-btn');
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.append(cancel, confirm);
  body.append(text, warning, error, actions);

  let current = null;
  let busy = false;

  function setBusy(value, label) {
    busy = value;
    cancel.disabled = value;
    confirm.disabled = value;
    confirm.textContent = value ? 'Guardando…' : label;
  }

  confirm.addEventListener('click', async () => {
    const { action, user, copy } = current;
    error.hidden = true;
    setBusy(true, copy.confirm);
    const result = await onConfirm(action, user.email);
    setBusy(false, copy.confirm);
    if (result.ok) {
      dialog.close();
      return;
    }
    error.textContent = result.message;
    error.hidden = false;
    cancel.focus();
  });

  // Mientras se guarda no se cierra con Esc ni tocando fuera.
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener(
    'click',
    (event) => {
      if (busy && event.target === dialog) event.stopImmediatePropagation();
    },
    { capture: true },
  );
  dialog.addEventListener('close', () => {
    if (current && !current.opener.isConnected) restoreFocus(current.user.email);
  });

  return (action, user, opener) => {
    const copy = CONFIRMATIONS[action](user, displayedName(user));
    current = { action, user, copy, opener };
    title.textContent = copy.title;
    text.textContent = copy.text;
    warning.textContent = copy.warning ?? '';
    warning.hidden = !copy.warning;
    error.hidden = true;
    confirm.className = `dialog-btn ${copy.danger ? 'danger' : 'primary'}`;
    setBusy(false, copy.confirm);
    open(opener, cancel);
  };
}
