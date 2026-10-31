// Menú de etiquetas (prioridad y fecha límite) de una tarjeta: abrirlo y cerrarlo, el foco dentro del
// menú y al cerrarlo, y el clic fuera. Solo hay un menú abierto a la vez. Parte de la vista del tablero
// (BoardPage.js); el menú lo dibuja components/LabelMenu.js.
import { isEditable } from '../../components/TaskCard.js';

/**
 * @param {object} deps
 * @param {() => void} deps.render
 * @param {() => void} deps.beforeToggle Se llama antes de abrir o cerrar (guarda la edición en curso).
 */
export function createLabelMenuController({ render, beforeToggle }) {
  // Tarea con el menú de etiquetas abierto; null si no hay ninguno.
  let openId = null;

  function toggle(id) {
    beforeToggle();
    openId = openId === id ? null : id;
    render();
    if (openId === null) return;
    const menu = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .label-menu`);
    if (!menu) return;
    menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const current = menu.querySelector('[aria-pressed="true"]') || menu.querySelector('button');
    if (current) current.focus({ preventScroll: true });
  }

  // restoreFocus devuelve el foco al botón de etiquetas (teclado).
  function close(restoreFocus = false) {
    if (openId === null) return;
    const id = openId;
    openId = null;
    render();
    if (!restoreFocus) return;
    const button = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .label-btn`);
    if (button) button.focus({ preventScroll: true });
  }

  return {
    toggle,
    close,

    isOpen(id) {
      return openId === id;
    },

    // Lo da por cerrado sin redibujar (al empezar a editar, o si se borra su tarea).
    forget(id = openId) {
      if (openId === id) openId = null;
    },

    // Al empezar a dibujar: si su tarea ya no existe o se completó, el menú se cierra.
    reconcile(all) {
      const menuTask = all.find((t) => t.id === openId);
      if (openId !== null && (!menuTask || !isEditable(menuTask))) openId = null;
    },

    // Guarda qué control del menú tiene el foco antes de dibujar; la función devuelta se lo devuelve.
    preserveFocus() {
      const menuFocusKey = document.activeElement?.closest?.('.label-menu')
        ? document.activeElement.dataset.menuKey
        : null;
      return () => {
        if (!menuFocusKey || openId === null) return;
        const control = document.querySelector(`.label-menu [data-menu-key="${menuFocusKey}"]`);
        if (control) control.focus({ preventScroll: true });
      };
    },

    // Un clic fuera del menú de etiquetas lo cierra.
    listen() {
      document.addEventListener('click', (event) => {
        if (openId !== null && !event.target.closest('.label-menu, .label-btn')) close();
      });
    },
  };
}
