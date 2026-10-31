// Asistente para eliminar a una persona (docs/PLAN_USUARIOS.md, 2.4 flujo 5; boceto
// docs/propuestas/propuestas-usuarios/gestion-usuarios.html): un solo diálogo en pasos. Sin un
// respaldo listo muestra el comando del script; con él, las consecuencias (confirmación 1), el
// correo escrito (confirmación 2) y el progreso del borrado. El foco empieza en Cancelar en las dos
// confirmaciones; mientras se borra no se cierra (ni con Esc ni tocando fuera) y el navegador avisa
// antes de cerrar la pestaña.
import { matchesEmail, normalizeEmail } from '../../domain/rules/permissions.js';
import { USERS_MESSAGES } from '../../shared/constants/messages.js';
import { formatDate } from '../format/dates.js';
import { createButton, createDialog } from './Dialog.js';
import { displayedName } from './UserList.js';

const STEPS = ['1 Respaldo', '2 Confirmar', '3 Borrar'];

/**
 * Comando del script que hace el respaldo verificado y crea el marcador (2.11).
 * @param {{ ambiente: string, admin: string, email: string }} options
 */
export function backupCommand({ ambiente, admin, email }) {
  return `npm run admin -- respaldar --ambiente ${ambiente} --admin ${admin} --correo ${email} --aplicar`;
}

/**
 * Comando del script que borra los restos de una persona en eliminación. El uid no se muestra en
 * la página (2.3): está en su documento de allowedUsers, en la consola.
 * @param {{ ambiente: string, admin: string }} options
 */
export function cleanupCommand({ ambiente, admin }) {
  return `npm run admin -- limpiar-usuario --ambiente ${ambiente} --admin ${admin} --uid <su uid> --aplicar`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Párrafo con un tramo en negrita: [antes, negrita, después].
function textWithStrong(className, [before, strong, after = '']) {
  const node = element('p', className, before);
  node.append(element('strong', '', strong), after);
  return node;
}

function command(text) {
  const node = element('pre', 'delete-command');
  node.append(element('code', '', text));
  return node;
}

function actionsRow(...buttons) {
  const node = element('div', 'dialog-actions');
  node.append(...buttons);
  return node;
}

/**
 * @typedef {import('../state/usersStore.js').UserRow} UserRow
 * @typedef {import('../state/usersStore.js').ActionResult} ActionResult
 *
 * @param {object} handlers
 * @param {(email: string, confirmation: string) => Promise<ActionResult>} handlers.onDelete
 * @param {(email: string) => Promise<ActionResult>} handlers.onResume
 * @param {() => { ambiente: string, admin: string }} handlers.commandOptions Ambiente y correo de
 *   quien tiene la sesión, para los comandos del script.
 * @param {string} handlers.authConsoleUrl Consola de Authentication del ambiente.
 * @param {(email: string) => void} handlers.restoreFocus Devuelve el foco a la página si la fila que
 *   abrió el asistente ya no existe (la lista cambió o la persona se eliminó).
 */
export function createDeleteWizard({ onDelete, onResume, commandOptions, authConsoleUrl, restoreFocus }) {
  const { dialog, body, open } = createDialog('delete-dialog', '');
  dialog.classList.add('users-dialog');
  const title = body.querySelector('.dialog-title');

  const steps = element('ol', 'delete-steps');
  steps.setAttribute('aria-label', 'Pasos de la eliminación');
  const stepItems = STEPS.map((text) => element('li', '', text));
  steps.append(...stepItems);
  body.prepend(steps);

  const content = element('div', 'delete-content');
  body.append(content);

  let current = null;
  let running = false;

  function setStep(index, heading) {
    stepItems.forEach((item, i) => {
      if (i === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    title.textContent = heading;
  }

  const close = () => dialog.close();
  const cancelButton = () => createButton('Cancelar', 'dialog-btn', close);

  // Paso 1 sin respaldo listo: el comando del script y cómo seguir.
  function showBackup({ user, marker }) {
    setStep(0, 'Primero, el respaldo');
    const understood = createButton('Entendido', 'dialog-btn primary', close);
    const nodes = [
      textWithStrong('dialog-text', [
        'Antes de eliminar a ',
        displayedName(user),
        ' hay que hacer un respaldo completo y verificado. Ejecútalo en tu equipo con tus credenciales de Google:',
      ]),
      command(backupCommand({ ...commandOptions(), email: user.email })),
      textWithStrong('dialog-text', [
        'Cuando el script termine, vuelve aquí: esta página se actualiza sola y aparecerá ',
        'Eliminar definitivamente…',
      ]),
      actionsRow(understood),
    ];
    // Un respaldo preparado pero vencido: hay que repetirlo.
    if (marker?.state === 'backup-ready')
      nodes.unshift(element('p', 'users-warn', USERS_MESSAGES.reasons['backup-stale']));
    content.replaceChildren(...nodes);
    return understood;
  }

  // Confirmación 1: qué se borra y los datos del respaldo.
  function showConsequences({ user, marker }) {
    setStep(1, `¿Eliminar a ${displayedName(user)}?`);
    const list = element('ul', 'dialog-list');
    list.append(
      element('li', '', 'Todas sus tareas y su historial.'),
      element('li', '', 'Sus permisos y su autorización para entrar.'),
    );
    const facts = element('dl', 'delete-facts');
    facts.append(
      element('dt', '', 'Respaldo'),
      element('dd', '', `Verificado el ${formatDate(marker.backupAt)}`),
      element('dt', '', 'Tareas'),
      element('dd', '', String(marker.taskCount)),
    );
    const cancel = cancelButton();
    const next = createButton('Continuar', 'dialog-btn', () => showConfirmation(current.row));
    content.replaceChildren(
      element('p', 'dialog-text', 'Se borrarán, sin posibilidad de deshacerlo:'),
      list,
      facts,
      element(
        'p',
        'users-warn',
        'Su cuenta de Authentication no se borra aquí: hay que borrarla después en la consola.',
      ),
      actionsRow(cancel, next),
    );
    return cancel;
  }

  // Confirmación 2: escribir el correo exacto. El botón solo se habilita si coincide.
  function showConfirmation({ user }) {
    setStep(1, 'Confirma la eliminación');
    const form = element('form', 'dialog-form');
    form.noValidate = true;
    const label = element('label', '', 'Correo');
    label.htmlFor = 'delete-confirm-email';
    const input = element('input');
    input.id = 'delete-confirm-email';
    input.type = 'email';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    const error = element('p', 'form-error', USERS_MESSAGES.reasons['email-mismatch']);
    error.id = 'delete-confirm-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    input.setAttribute('aria-describedby', error.id);

    const cancel = cancelButton();
    const submit = createButton('Eliminar definitivamente', 'dialog-btn danger');
    submit.type = 'submit';
    submit.disabled = true;

    input.addEventListener('input', () => {
      const typed = normalizeEmail(input.value);
      submit.disabled = !matchesEmail(input.value, user.email);
      // El aviso aparece en cuanto lo escrito deja de ser el comienzo del correo.
      const mismatch = typed !== '' && !user.email.startsWith(typed);
      error.hidden = !mismatch;
      if (mismatch) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      showProgress('Confirmando la eliminación…');
      status.focus();
      onDelete(user.email, input.value).then(finished);
    });

    form.append(
      textWithStrong('dialog-text', ['Para confirmar, escribe el correo de la persona: ', user.email]),
      label,
      input,
      error,
      actionsRow(cancel, submit),
    );
    content.replaceChildren(form);
    cancel.focus();
  }

  // Paso 3: el borrado con su avance y el resultado. El texto del avance recibe el foco mientras se
  // borra, porque Cerrar está deshabilitado.
  const status = element('p', 'dialog-text');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.tabIndex = -1;
  const bar = element('span');
  const progressBar = element('div', 'delete-progress');
  progressBar.setAttribute('aria-hidden', 'true');
  progressBar.append(bar);
  const keepOpen = element(
    'p',
    'dialog-text',
    'No cierres esta pestaña. Si se interrumpe, podrás reanudar la eliminación.',
  );
  const failure = element('p', 'form-error');
  failure.setAttribute('role', 'alert');
  const extra = element('div', 'delete-extra');
  const closeButton = createButton('Cerrar', 'dialog-btn primary', close);

  function setProgress(done, total) {
    status.textContent = USERS_MESSAGES.deletionProgress(done, total);
    bar.style.width = `${total === 0 ? 100 : Math.round((done / total) * 100)}%`;
  }

  function finished({ ok, reason, message }) {
    running = false;
    window.removeEventListener('beforeunload', warnBeforeUnload);
    keepOpen.hidden = true;
    closeButton.disabled = false;
    if (ok) {
      setStep(2, 'Eliminación terminada');
      setProgress(1, 1);
      status.textContent = message;
      const link = element('a', '', 'Abrir Authentication de este ambiente');
      link.href = authConsoleUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(element('span', 'visually-hidden', ' (se abre en otra pestaña)'));
      const hint = element('p', 'dialog-text', 'Allí: Users → ⋮ en su cuenta → Delete account. ');
      hint.append(link);
      extra.replaceChildren(hint);
    } else {
      setStep(2, 'No se pudo terminar');
      failure.textContent = message;
      failure.hidden = false;
      extra.replaceChildren(
        ...(reason === 'leftovers'
          ? [
              element('p', 'dialog-text', 'Su uid está en su documento de allowedUsers (consola de Firestore):'),
              command(cleanupCommand(commandOptions())),
              element('p', 'dialog-text', 'Después vuelve aquí y pulsa Reanudar eliminación.'),
            ]
          : []),
      );
    }
    closeButton.focus();
  }

  function showProgress(firstText) {
    setStep(2, 'Eliminando…');
    running = true;
    window.addEventListener('beforeunload', warnBeforeUnload);
    status.textContent = firstText;
    bar.style.width = '0%';
    keepOpen.hidden = false;
    failure.hidden = true;
    extra.replaceChildren();
    closeButton.disabled = true;
    content.replaceChildren(status, progressBar, keepOpen, failure, extra, actionsRow(closeButton));
  }

  function warnBeforeUnload(event) {
    event.preventDefault();
    event.returnValue = '';
  }

  // Mientras se borra no se cierra con Esc ni tocando fuera (el clic se detiene antes de que llegue
  // al cierre de Dialog.js).
  dialog.addEventListener('cancel', (event) => {
    if (running) event.preventDefault();
  });
  dialog.addEventListener(
    'click',
    (event) => {
      if (running && event.target === dialog) event.stopImmediatePropagation();
    },
    { capture: true },
  );
  dialog.addEventListener('close', () => {
    if (current && !current.opener.isConnected) restoreFocus(current.row.user.email);
  });

  return {
    /**
     * Abre el asistente: eliminar (respaldo o confirmaciones, según el marcador) o reanudar.
     * @param {'delete' | 'resume'} action
     * @param {UserRow} row
     * @param {HTMLElement} opener
     */
    open(action, row, opener) {
      current = { row, opener };
      if (action === 'resume') {
        showProgress('Comprobando lo que queda por borrar…');
        open(opener, status);
        onResume(row.user.email).then(finished);
        return;
      }
      open(opener, row.backupReady ? showConsequences(row) : showBackup(row));
    },

    /**
     * Avance del borrado que avisa el store.
     * @param {{ email: string, done: number, total: number }} progress
     */
    progress({ email, done, total }) {
      if (running && current?.row.user.email === email) setProgress(done, total);
    },
  };
}
