// Zona de usuario de las páginas autenticadas de LUCAS (inicio y tablero): nombre, cambiar
// contraseña y cerrar sesión, con sus diálogos. Cerrar sesión siempre pide confirmación.
import { errorMessage } from '../../shared/constants/messages.js';
import { changePassword, signOut } from '../guards/session.js';

const MIN_PASSWORD_LENGTH = 6;
const TOAST_DURATION = 3000;

function initials(name) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return letters || '?';
}

// Círculo con la foto de Google o, si no hay (o no carga), las iniciales.
function createAvatar(session) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initials(session.name);
  if (session.photoURL) {
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = session.photoURL;
    img.addEventListener('load', () => avatar.replaceChildren(img));
  }
  return avatar;
}

function createButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

// Aviso breve tras una acción de cuenta (por ejemplo, contraseña actualizada).
let toast = null;
let toastTimeout = null;

function showToast(message) {
  if (!toast) {
    toast = document.createElement('p');
    toast.className = 'lucas-toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), TOAST_DURATION);
}

/* ---------- Diálogos ---------- */

// Ventana modal accesible: Esc, Cancelar o tocar fuera la cierran, y el foco vuelve al
// control que la abrió. El contenido va en un envoltorio para distinguir el clic en el fondo.
function createDialog(id, titleText) {
  const dialog = document.createElement('dialog');
  dialog.className = 'lucas-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);

  const body = document.createElement('div');
  body.className = 'dialog-body';
  const title = document.createElement('h2');
  title.id = `${id}-title`;
  title.className = 'dialog-title';
  title.textContent = titleText;
  body.append(title);
  dialog.append(body);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  let returnFocus = null;
  dialog.addEventListener('close', () => {
    if (returnFocus) returnFocus.focus();
  });

  document.body.append(dialog);
  return {
    dialog,
    body,
    open(opener, focusTarget) {
      returnFocus = opener;
      dialog.showModal();
      focusTarget.focus();
    },
  };
}

function createLogoutDialog(session) {
  const { dialog, body, open } = createDialog('logout-dialog', '¿Cerrar sesión?');

  const text = document.createElement('p');
  text.className = 'dialog-text';
  text.textContent = 'Tendrás que volver a iniciar sesión para ver el tablero en este dispositivo.';

  // Cancelar recibe el foco, para que Enter no cierre la sesión sin querer.
  const cancel = createButton('Cancelar', 'dialog-btn', () => dialog.close());
  const confirm = createButton('Cerrar sesión', 'dialog-btn danger', () => {
    confirm.disabled = true;
    cancel.disabled = true;
    signOut(session);
  });

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.append(cancel, confirm);
  body.append(text, actions);

  return (opener) => open(opener, cancel);
}

// Campo de contraseña con botón mostrar/ocultar.
function createPasswordField(id, labelText, autocomplete) {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;

  const wrapper = document.createElement('div');
  wrapper.className = 'password-field';
  const input = document.createElement('input');
  input.type = 'password';
  input.id = id;
  input.autocomplete = autocomplete;
  input.required = true;

  const toggle = createButton('Mostrar', 'toggle-password');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-label', `Mostrar ${labelText.toLowerCase()}`);
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', `${show ? 'Ocultar' : 'Mostrar'} ${labelText.toLowerCase()}`);
  });

  wrapper.append(input, toggle);
  return { label, wrapper, input, toggle };
}

function createPasswordDialog(session) {
  const { dialog, body, open } = createDialog('password-dialog', 'Cambiar contraseña');

  const form = document.createElement('form');
  form.className = 'dialog-form';
  form.noValidate = true;

  // Campo de usuario oculto: ayuda a los gestores de contraseñas a guardar la nueva.
  const username = document.createElement('input');
  username.type = 'email';
  username.autocomplete = 'username';
  username.value = session.email;
  username.readOnly = true;
  username.tabIndex = -1;
  username.className = 'visually-hidden';
  username.setAttribute('aria-hidden', 'true');

  const error = document.createElement('p');
  error.className = 'form-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const current = createPasswordField('current-password', 'Contraseña actual', 'current-password');
  const next = createPasswordField('new-password', 'Contraseña nueva', 'new-password');
  const repeat = createPasswordField('repeat-password', 'Repite la contraseña nueva', 'new-password');
  const fields = [current, next, repeat];

  const cancel = createButton('Cancelar', 'dialog-btn', () => dialog.close());
  const save = createButton('Guardar', 'dialog-btn primary');
  save.type = 'submit';

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.append(cancel, save);

  form.append(username, error);
  fields.forEach(({ label, wrapper }) => form.append(label, wrapper));
  form.append(actions);
  body.append(form);

  function showError(message, field) {
    error.textContent = message;
    error.hidden = false;
    field.focus();
  }

  function reset() {
    form.reset();
    error.hidden = true;
    save.disabled = false;
    save.textContent = 'Guardar';
    fields.forEach(({ input, toggle }) => {
      if (input.type === 'text') toggle.click();
    });
  }

  function validate() {
    if (!current.input.value) return ['Escribe tu contraseña actual.', current.input];
    if (next.input.value.length < MIN_PASSWORD_LENGTH) return ['Usa al menos 6 caracteres.', next.input];
    if (next.input.value === current.input.value)
      return ['La contraseña nueva debe ser distinta de la actual.', next.input];
    if (next.input.value !== repeat.input.value) return ['Las contraseñas nuevas no coinciden.', repeat.input];
    return null;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      showError(...problem);
      return;
    }

    error.hidden = true;
    save.disabled = true;
    save.textContent = 'Guardando…';
    try {
      // Se reautentica siempre con la contraseña actual (ver FirebaseAuthRepository).
      await changePassword(session, current.input.value, next.input.value);
    } catch (failure) {
      save.disabled = false;
      save.textContent = 'Guardar';
      const wrongCurrent = ['auth/invalid-credential', 'auth/wrong-password'].includes(failure.code);
      const message = wrongCurrent ? 'La contraseña actual no es correcta.' : errorMessage(failure);
      showError(message || 'No se pudo cambiar la contraseña.', wrongCurrent ? current.input : next.input);
      return;
    }
    dialog.close();
    showToast('Tu contraseña se actualizó.');
  });

  return (opener) => {
    reset();
    open(opener, current.input);
  };
}

/* ---------- Zona de usuario ---------- */

// En escritorio muestra avatar, nombre y acciones; en celular solo el avatar, que despliega
// el nombre y las acciones (ver lucas.css).
export function mountAccountMenu(session, container) {
  container.classList.add('account');
  container.replaceChildren();

  const toggle = createButton('', 'account-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'account-panel');
  toggle.setAttribute('aria-label', `Cuenta de ${session.name}`);
  toggle.append(createAvatar(session));

  const panel = document.createElement('div');
  panel.className = 'account-panel';
  panel.id = 'account-panel';

  const name = document.createElement('span');
  name.className = 'account-name';
  name.textContent = session.name;
  name.title = session.email;
  panel.append(createAvatar(session), name);

  function setOpen(open) {
    container.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  // Al abrir un diálogo desde el menú desplegable, el foco vuelve al avatar (el menú se cierra).
  function opener(button) {
    const inMenu = toggle.offsetParent !== null;
    setOpen(false);
    return inMenu ? toggle : button;
  }

  // Solo las cuentas con contraseña pueden cambiarla; las de solo Google no tienen una.
  if (session.hasPassword) {
    const openPasswordDialog = createPasswordDialog(session);
    const passwordBtn = createButton('Cambiar contraseña', 'account-action', () =>
      openPasswordDialog(opener(passwordBtn)),
    );
    panel.append(passwordBtn);
  }

  const openLogoutDialog = createLogoutDialog(session);
  const logoutBtn = createButton('Cerrar sesión', 'account-action logout', () => openLogoutDialog(opener(logoutBtn)));
  panel.append(logoutBtn);

  toggle.addEventListener('click', () => setOpen(!container.classList.contains('open')));
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && container.classList.contains('open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!container.contains(event.target)) setOpen(false);
  });

  container.append(toggle, panel);
}
