// Diálogo "Autorizar un correo" de la página de usuarios (docs/PLAN_USUARIOS.md, 2.4, flujo 1):
// correo, nombre y rol. Dar el rol de administrador muestra la advertencia y pide marcar una
// casilla. Los errores se muestran dentro del diálogo, junto al campo que hay que corregir.
import { NAME_MAX_LENGTH } from '../../domain/rules/permissions.js';
import { createButton, createDialog } from './Dialog.js';

// Campo que hay que corregir según el motivo del rechazo.
const FIELD_FOR = {
  'invalid-email': 'email',
  'already-authorized': 'email',
  self: 'email',
  'missing-name': 'name',
  'name-too-long': 'name',
  'unknown-role': 'role',
  'admin-not-confirmed': 'confirm',
};

function field(id, labelText, control) {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  control.id = id;
  return [label, control];
}

function input(type, autocomplete) {
  const node = document.createElement('input');
  node.type = type;
  node.autocomplete = autocomplete;
  node.required = true;
  return node;
}

/**
 * @param {{ onSubmit: (input: { email: string, name: string, role: string, adminConfirmed: boolean })
 *   => Promise<import('../state/usersStore.js').ActionResult> }} handlers
 * @returns {(opener: HTMLElement) => void} Abre el diálogo vacío.
 */
export function createUserForm({ onSubmit }) {
  const { dialog, body, open } = createDialog('authorize-dialog', 'Autorizar un correo');
  dialog.classList.add('users-dialog');

  const form = document.createElement('form');
  form.className = 'dialog-form';
  form.noValidate = true;

  const intro = document.createElement('p');
  intro.className = 'dialog-text';
  intro.textContent = 'La persona podrá entrar a LUCAS con este correo. Empieza con el tablero habilitado.';

  const error = document.createElement('p');
  error.className = 'form-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const email = input('email', 'off');
  email.spellcheck = false;
  email.setAttribute('autocapitalize', 'off');
  const name = input('text', 'off');
  name.maxLength = NAME_MAX_LENGTH;

  const role = document.createElement('select');
  [
    ['member', 'Miembro'],
    ['admin', 'Administrador'],
  ].forEach(([value, text]) => role.append(new Option(text, value)));

  // Advertencia del rol de administrador, con la casilla que lo confirma.
  const warning = document.createElement('div');
  warning.className = 'users-warn';
  warning.id = 'authorize-admin-warning';
  warning.hidden = true;
  const warningText = document.createElement('p');
  warningText.textContent = 'Podrá ver y gestionar usuarios y permisos, pero no las tareas de nadie.';
  const confirm = document.createElement('input');
  confirm.type = 'checkbox';
  confirm.id = 'authorize-admin-confirm';
  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'check';
  confirmLabel.append(confirm, ' Entiendo y quiero darle el rol de administrador.');
  warning.append(warningText, confirmLabel);
  role.setAttribute('aria-describedby', warning.id);

  const hint = document.createElement('p');
  hint.className = 'dialog-text users-hint';
  hint.textContent = '¿Entrará con correo y contraseña? Crea también su cuenta en Authentication.';

  const cancel = createButton('Cancelar', 'dialog-btn', () => dialog.close());
  const submit = createButton('Autorizar', 'dialog-btn primary');
  submit.type = 'submit';
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.append(cancel, submit);

  form.append(
    intro,
    error,
    ...field('authorize-email', 'Correo', email),
    ...field('authorize-name', 'Nombre que verá LUCAS', name),
    ...field('authorize-role', 'Rol', role),
    warning,
    hint,
    actions,
  );
  body.append(form);

  const controls = { email, name, role, confirm };

  role.addEventListener('change', () => {
    warning.hidden = role.value !== 'admin';
    if (warning.hidden) confirm.checked = false;
  });

  function clearError() {
    error.hidden = true;
    Object.values(controls).forEach((control) => control.removeAttribute('aria-invalid'));
  }

  function showError(message, reason) {
    error.textContent = message;
    error.hidden = false;
    const control = controls[FIELD_FOR[reason]] ?? email;
    control.setAttribute('aria-invalid', 'true');
    control.focus();
  }

  function setBusy(busy) {
    submit.disabled = busy;
    cancel.disabled = busy;
    submit.textContent = busy ? 'Autorizando…' : 'Autorizar';
  }

  // Mientras se guarda no se cierra con Esc ni tocando fuera (el clic se detiene antes de que
  // llegue al cierre de Dialog.js).
  dialog.addEventListener('cancel', (event) => {
    if (submit.disabled) event.preventDefault();
  });
  dialog.addEventListener(
    'click',
    (event) => {
      if (submit.disabled && event.target === dialog) event.stopImmediatePropagation();
    },
    { capture: true },
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    setBusy(true);
    const result = await onSubmit({
      email: email.value,
      name: name.value,
      role: role.value,
      adminConfirmed: confirm.checked,
    });
    setBusy(false);
    if (result.ok) dialog.close();
    else showError(result.message, result.reason);
  });

  return (opener) => {
    form.reset();
    warning.hidden = true;
    clearError();
    setBusy(false);
    open(opener, email);
  };
}
