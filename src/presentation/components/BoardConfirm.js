// Confirmación de las acciones del tablero (docs/PLAN_SUBTAREAS.md, 1.3 a 1.6): borrar una tarea, borrar
// las completadas y, más adelante, las de las subtareas. Un solo <dialog> modal (Dialog.js) que cambia de
// texto según la acción. El foco empieza en Cancelar, para que Enter no confirme sin querer; Escape,
// Cancelar o tocar fuera cierran sin hacer nada. Mientras está abierto sigue los cambios del tablero:
// actualiza su texto o, si la acción ya no aplica (otro dispositivo borró la tarea), se cierra con un
// aviso. Es propio del tablero: la página de usuarios tiene el suyo (ConfirmDialogs.js).
import { BOARD_MESSAGES } from '../../shared/constants/messages.js';
import { createButton, createDialog } from './Dialog.js';

const ID = 'board-confirm';

/**
 * Lo que pide confirmar una acción.
 * @typedef {object} ConfirmRequest
 * @property {string} title
 * @property {string} text Qué va a pasar (nombra la tarea o la cantidad).
 * @property {string | null} [warning] Advertencia aparte, por ejemplo que no se puede deshacer.
 * @property {string} confirmLabel Nombre de la acción en el botón ("Borrar tarea").
 * @property {string} icon Ícono del botón; los lectores de pantalla no lo leen.
 * @property {'danger' | 'primary'} tone danger para las acciones destructivas.
 * @property {HTMLElement | null} opener Control que abrió el diálogo; recibe el foco al cancelar.
 * @property {() => void} onConfirm Se llama una sola vez, al confirmar.
 * @property {() => ({ text: string } | null)} [refresh] Con el diálogo abierto, en cada cambio del
 *   tablero: el texto nuevo, o null si la acción ya no aplica.
 * @property {string} [gone] Aviso al cerrarse porque la acción ya no aplica.
 * @property {(confirmed: boolean) => HTMLElement | null} [focusAfter] A dónde va el foco si el opener ya
 *   no está en la página (se volvió a dibujar) o si se confirmó.
 */

/**
 * @param {object} deps
 * @param {{ on: (type: 'change', listener: () => void) => void }} deps.store Avisa de cada cambio.
 * @param {(message: string) => void} deps.showNotice
 * @returns {(request: ConfirmRequest) => void}
 */
export function createBoardConfirm({ store, showNotice }) {
  const { dialog, body, open } = createDialog(ID, '');
  dialog.classList.add('board-confirm');
  const title = body.querySelector('.dialog-title');

  const text = document.createElement('p');
  text.id = `${ID}-text`;
  text.className = 'dialog-text';

  const warning = document.createElement('p');
  warning.id = `${ID}-warning`;
  warning.className = 'dialog-warn';
  const warningIcon = document.createElement('span');
  warningIcon.setAttribute('aria-hidden', 'true');
  warningIcon.textContent = '⚠';
  const warningText = document.createElement('span');
  warning.append(warningIcon, ' ', warningText);

  const cancel = createButton(BOARD_MESSAGES.cancel, 'dialog-btn', () => dialog.close());
  const confirm = createButton('', 'dialog-btn');
  const confirmIcon = document.createElement('span');
  confirmIcon.setAttribute('aria-hidden', 'true');
  const confirmText = document.createElement('span');
  confirm.append(confirmIcon, ' ', confirmText);

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.append(cancel, confirm);
  body.append(text, warning, actions);

  /** @type {(ConfirmRequest & { confirmed: boolean }) | null} */
  let current = null;

  confirm.addEventListener('click', () => {
    // Un doble clic no repite la acción: la primera vez el diálogo deja de estar a la espera.
    if (!current || current.confirmed) return;
    current.confirmed = true;
    confirm.disabled = true;
    current.onConfirm();
    dialog.close();
  });

  // Dialog.js devuelve el foco al opener; si ya no existe o se confirmó, se busca otro destino.
  dialog.addEventListener('close', () => {
    const request = current;
    current = null;
    if (!request) return;
    if (!request.confirmed && request.opener?.isConnected) return;
    request.focusAfter?.(request.confirmed)?.focus({ preventScroll: true });
  });

  // Después de dibujar el tablero (por eso en una microtarea): el diálogo sigue lo que se ve.
  store.on('change', () => {
    queueMicrotask(() => {
      if (!current || current.confirmed || !dialog.open || !current.refresh) return;
      const next = current.refresh();
      if (next) {
        text.textContent = next.text;
        return;
      }
      const { gone } = current;
      dialog.close();
      if (gone) showNotice(gone);
    });
  });

  return (request) => {
    current = { ...request, confirmed: false };
    title.textContent = request.title;
    text.textContent = request.text;
    warningText.textContent = request.warning ?? '';
    warning.hidden = !request.warning;
    // Un elemento oculto también se leería si aria-describedby lo nombra: solo se nombra si hay advertencia.
    dialog.setAttribute('aria-describedby', request.warning ? `${ID}-text ${ID}-warning` : `${ID}-text`);
    confirmIcon.textContent = request.icon;
    confirmText.textContent = request.confirmLabel;
    confirm.className = `dialog-btn ${request.tone}`;
    confirm.disabled = false;
    open(request.opener, cancel);
  };
}
