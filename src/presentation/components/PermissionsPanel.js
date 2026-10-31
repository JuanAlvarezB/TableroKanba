// Panel de permisos de una persona (docs/PLAN_USUARIOS.md, 3.7; boceto
// docs/propuestas/propuestas-usuarios/permisos-usuario.html): un diálogo en dos pasos que se abre con
// Permisos… en la fila de la página de usuarios. Paso 1: un interruptor por función, el tablero y debajo
// sus hijas; con el tablero apagado las hijas se ven deshabilitadas con su valor guardado. Paso 2: el
// resumen de los cambios y Guardar, que escribe un solo lote con su entrada set-permissions. El panel de un
// administrador es de solo lectura (tiene siempre todas las funciones). Nada se escribe hasta confirmar.
import { FEATURES, FEATURE_KEYS } from '../../domain/rules/features.js';
import { FEATURE_LABELS } from '../format/labels.js';
import { createButton, createDialog } from './Dialog.js';
import { ROLE_LABELS, displayedName } from './UserList.js';

/**
 * @typedef {import('../../domain/rules/features.js').FeatureFlags} FeatureFlags
 * @typedef {import('../../domain/rules/features.js').FeatureKey} FeatureKey
 *
 * @typedef {object} PanelItem
 * @property {FeatureKey} key
 * @property {boolean} child Depende de otra función (se dibuja debajo del tablero).
 * @property {boolean} checked Lo que muestra el interruptor: el valor propio, o todo activo en un administrador.
 * @property {boolean} disabled Solo lectura, o su padre está apagado.
 * @property {boolean} changed Distinto del valor guardado.
 * @property {boolean} server firestore.rules la hace cumplir; si no, solo la pantalla.
 */

const PARENT = Object.fromEntries(FEATURES.map(({ key, parent }) => [key, parent]));

/**
 * Estado de cada interruptor. Con el padre apagado, una hija conserva (y muestra) su valor, pero no se puede
 * cambiar: se conserva para cuando vuelva a activarse.
 * @param {{ role: string }} user
 * @param {FeatureFlags} saved Valor propio guardado de cada función (usersStore.ownPermissions).
 * @param {FeatureFlags} draft Valor propio elegido en el panel.
 * @returns {PanelItem[]}
 */
export function panelItems(user, saved, draft) {
  const readOnly = user.role === 'admin';
  const isOn = (key) => draft[key] && (PARENT[key] === null || isOn(PARENT[key]));
  return FEATURES.map(({ key, parent, enforcedInRules }) => ({
    key,
    child: parent !== null,
    checked: readOnly || draft[key],
    disabled: readOnly || (parent !== null && !isOn(parent)),
    changed: !readOnly && draft[key] !== saved[key],
    server: enforcedInRules,
  }));
}

/**
 * Funciones que cambian, con su valor nuevo: lo que recibe usersStore.setPermissions.
 * @param {FeatureFlags} saved
 * @param {FeatureFlags} draft
 * @returns {Partial<FeatureFlags>}
 */
export function pendingChanges(saved, draft) {
  return Object.fromEntries(FEATURE_KEYS.filter((key) => draft[key] !== saved[key]).map((key) => [key, draft[key]]));
}

const stateWord = (value) => (value ? 'activada' : 'apagada');

/**
 * Resumen del paso 2, en el orden del catálogo: "Tablero de tareas: activada → apagada".
 * @param {FeatureFlags} saved
 * @param {FeatureFlags} draft
 * @returns {string[]}
 */
export function changeSummary(saved, draft) {
  return Object.entries(pendingChanges(saved, draft)).map(
    ([key, value]) => `${FEATURE_LABELS[key].name}: ${stateWord(saved[key])} → ${stateWord(value)}`,
  );
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionsRow(...buttons) {
  const node = element('div', 'dialog-actions');
  node.append(...buttons);
  return node;
}

const INTRO =
  'Elige qué funciones de LUCAS puede usar esta persona. Apagar una función la oculta, pero no borra sus datos: al reactivarla, todo vuelve igual.';
const READ_ONLY_NOTE = 'Los administradores tienen siempre todas las funciones. Este panel es de solo lectura.';
const PARENT_OFF_NOTE =
  'Con el tablero apagado, estas funciones tampoco están disponibles. Sus valores se conservan y vuelven al reactivar el tablero.';

/**
 * @param {object} handlers
 * @param {(user: import('../../domain/entities/User.js').AllowedUser) => FeatureFlags} handlers.permissionsOf
 *   Valor propio guardado de cada función (usersStore.ownPermissions).
 * @param {(email: string, changes: Partial<FeatureFlags>) => Promise<import('../state/usersStore.js').ActionResult>} handlers.onSave
 * @param {(email: string) => void} handlers.restoreFocus Devuelve el foco a la fila si la lista se volvió a
 *   dibujar mientras el panel estaba abierto (guardar la actualiza en vivo).
 * @returns {(row: import('../state/usersStore.js').UserRow, opener: HTMLElement) => void}
 */
export function createPermissionsPanel({ permissionsOf, onSave, restoreFocus }) {
  const { dialog, body, open } = createDialog('permissions-dialog', '');
  dialog.classList.add('users-dialog', 'permissions-dialog');
  const title = body.querySelector('.dialog-title');
  const content = element('div', 'permissions-content');
  body.append(content);

  /* ---------- Paso 1: los interruptores ---------- */

  const email = element('p', 'person-email');
  const role = element('span', 'tag');
  const person = element('div', 'permissions-person');
  person.append(email, role);
  const intro = element('p', 'dialog-text');
  intro.id = 'permissions-intro';

  // Cada función con su nombre, descripción, dónde se cumple y su interruptor. El interruptor muestra su
  // estado con texto y forma (no solo color); su nombre y su descripción le llegan al lector de pantalla.
  const items = new Map(
    FEATURES.map(({ key, enforcedInRules }) => {
      const item = element('li', 'feature');
      const text = element('div', 'feature-text');
      const name = element('p', 'feature-name', FEATURE_LABELS[key].name);
      name.id = `permission-${key}-name`;
      const description = element('p', 'feature-desc', FEATURE_LABELS[key].description);
      description.id = `permission-${key}-desc`;
      const enforced = element(
        'span',
        `enforced ${enforcedInRules ? 'server' : 'ui'}`,
        enforcedInRules ? 'Se aplica en el servidor' : 'Solo en la pantalla',
      );
      enforced.id = `permission-${key}-where`;
      const unsaved = element('span', 'unsaved');
      unsaved.id = `permission-${key}-unsaved`;
      text.append(name, description, enforced, unsaved);

      const button = element('button', 'switch');
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-labelledby', name.id);
      button.setAttribute('aria-describedby', `${description.id} ${enforced.id} ${unsaved.id}`);
      const state = element('span', 'switch-state');
      const track = element('span', 'track');
      track.setAttribute('aria-hidden', 'true');
      button.append(state, track);
      button.addEventListener('click', () => {
        draft = { ...draft, [key]: !draft[key] };
        update();
      });

      item.append(text, button);
      return [key, { item, button, state, unsaved }];
    }),
  );

  // Aviso del tablero apagado: se anuncia al apagarlo, porque el foco sigue en su interruptor.
  const parentOffNote = element('p', 'parent-off-note');
  parentOffNote.setAttribute('aria-live', 'polite');
  const list = element('ul', 'features');
  const children = element('ul', 'children');
  children.setAttribute('aria-label', 'Funciones del tablero');
  FEATURES.forEach(({ key, parent }) => (parent === null ? list : children).append(items.get(key).item));
  list.append(parentOffNote, children);

  const close = () => dialog.close();
  const closeButton = createButton('Cerrar', 'dialog-btn', close);
  const discardButton = createButton('Descartar', 'dialog-btn', () => {
    draft = { ...saved };
    update();
    items.get(FEATURE_KEYS[0]).button.focus();
  });
  const reviewButton = createButton('Guardar cambios…', 'dialog-btn primary', () => showSummary());
  const chooseActions = actionsRow(closeButton, discardButton, reviewButton);

  /* ---------- Paso 2: el resumen ---------- */

  const summaryText = element('p', 'dialog-text');
  const summary = element('ul', 'dialog-list');
  const error = element('p', 'form-error');
  error.setAttribute('role', 'alert');
  const backButton = createButton('Volver', 'dialog-btn', () => showChoose(reviewButton));
  const saveButton = createButton('Guardar', 'dialog-btn primary');

  /** @type {{ user: import('../../domain/entities/User.js').AllowedUser, opener: HTMLElement } | null} */
  let current = null;
  /** @type {FeatureFlags} */
  let saved;
  /** @type {FeatureFlags} */
  let draft;
  let busy = false;

  const readOnly = () => current.user.role === 'admin';

  function update() {
    const shown = panelItems(current.user, saved, draft);
    shown.forEach(({ key, checked, disabled, changed }) => {
      const { item, button, state, unsaved } = items.get(key);
      button.setAttribute('aria-checked', String(checked));
      button.disabled = disabled;
      state.textContent = checked ? 'Activa' : 'Apagada';
      item.classList.toggle('is-disabled', disabled && !readOnly());
      item.classList.toggle('changed', changed);
      unsaved.textContent = changed ? 'Sin guardar' : '';
      unsaved.hidden = !changed;
    });
    const parentOff = !readOnly() && shown.some(({ child, disabled }) => child && disabled);
    parentOffNote.textContent = parentOff ? PARENT_OFF_NOTE : '';
    parentOffNote.hidden = !parentOff;
    const dirty = shown.some(({ changed }) => changed);
    discardButton.disabled = !dirty;
    reviewButton.disabled = !dirty;
  }

  function showChoose(focusTarget = null) {
    const { user } = current;
    title.textContent = `Permisos de ${displayedName(user)}`;
    email.textContent = user.email;
    role.className = `tag ${user.role}`;
    role.textContent = ROLE_LABELS[user.role];
    intro.textContent = readOnly() ? READ_ONLY_NOTE : INTRO;
    intro.className = readOnly() ? 'readonly-note' : 'dialog-text';
    discardButton.hidden = readOnly();
    reviewButton.hidden = readOnly();
    update();
    content.replaceChildren(person, intro, list, chooseActions);
    focusTarget?.focus();
  }

  function showSummary() {
    title.textContent = '¿Guardar los cambios?';
    summaryText.replaceChildren(
      'Se aplicarán a ',
      element('strong', '', displayedName(current.user)),
      ' la próxima vez que use LUCAS (o al volver a su pestaña). Quedará en el registro de acciones.',
    );
    summary.replaceChildren(...changeSummary(saved, draft).map((line) => element('li', '', line)));
    error.hidden = true;
    setBusy(false);
    content.replaceChildren(summaryText, summary, error, actionsRow(backButton, saveButton));
    backButton.focus();
  }

  function setBusy(value) {
    busy = value;
    backButton.disabled = value;
    saveButton.disabled = value;
    saveButton.textContent = value ? 'Guardando…' : 'Guardar';
  }

  saveButton.addEventListener('click', async () => {
    error.hidden = true;
    setBusy(true);
    const result = await onSave(current.user.email, pendingChanges(saved, draft));
    setBusy(false);
    if (result.ok) {
      dialog.close();
      return;
    }
    error.textContent = result.message;
    error.hidden = false;
    backButton.focus();
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

  return (row, opener) => {
    current = { user: row.user, opener };
    saved = permissionsOf(row.user);
    draft = { ...saved };
    dialog.setAttribute('aria-describedby', intro.id);
    showChoose();
    // En el panel de solo lectura todo está deshabilitado: el foco va a Cerrar.
    open(opener, readOnly() ? closeButton : items.get(FEATURE_KEYS[0]).button);
  };
}
