// Arrastrar y soltar tarjetas: qué tarjeta se arrastra, el resaltado de la columna bajo el cursor y
// dónde queda la tarea al soltarla. Parte de la vista del tablero (BoardPage.js).
import { currentFeatures } from '../../state/features.js';

/**
 * Tarjeta del mismo grupo de etiqueta situada justo debajo del cursor, para insertar antes de ella.
 * Arrastrar no cambia la etiqueta: si se suelta en otro grupo, la tarea queda al principio o al final
 * del suyo. Sin agrupar (función priorities apagada) la columna sigue solo el orden manual
 * (docs/PLAN_USUARIOS.md, 3.1). Las cajas se piden solo al revisar cada tarjeta, en orden.
 * @template T
 * @param {{ card: T, priority: string, box: () => { top: number, height: number } }[]} cards En el orden
 *   de la columna, sin la que se arrastra; priority es '' en las tarjetas sin etiqueta.
 * @param {number} y Posición vertical del cursor.
 * @param {string | null} priority Etiqueta de la tarea arrastrada.
 * @param {boolean} grouped Si la columna se agrupa por etiqueta.
 * @returns {T | undefined}
 */
export function cardAfterY(cards, y, priority, grouped) {
  return cards
    .filter((entry) => !grouped || entry.priority === (priority ?? ''))
    .find((entry) => {
      const box = entry.box();
      return y < box.top + box.height / 2;
    })?.card;
}

function getCardAfterCursor(list, y, priority) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')].map((card) => ({
    card,
    priority: card.dataset.priority,
    box: () => card.getBoundingClientRect(),
  }));
  return cardAfterY(cards, y, priority, currentFeatures().priorities);
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {NodeListOf<HTMLElement>} deps.lists Las listas de las columnas (.task-list).
 */
export function createDragController({ store, lists }) {
  let draggedId = null;

  return {
    get isDragging() {
      return draggedId !== null;
    },

    // Acciones de la tarjeta (dragstart y dragend).
    start(id) {
      draggedId = id;
    },

    end() {
      draggedId = null;
      lists.forEach((list) => list.classList.remove('drag-over'));
    },

    listen() {
      lists.forEach((list) => {
        list.addEventListener('dragover', (event) => {
          // preventDefault es necesario para que el evento drop se dispare.
          event.preventDefault();
          list.classList.add('drag-over');
        });

        list.addEventListener('dragleave', (event) => {
          if (!list.contains(event.relatedTarget)) list.classList.remove('drag-over');
        });

        list.addEventListener('drop', (event) => {
          event.preventDefault();
          list.classList.remove('drag-over');
          if (draggedId === null) return;

          const dragged = store.tasks.find((t) => t.id === draggedId);
          if (!dragged) return;
          const afterCard = getCardAfterCursor(list, event.clientY, dragged.priority);
          const beforeId = afterCard ? afterCard.dataset.id : null;
          store.move(draggedId, list.dataset.status, beforeId);
        });
      });
    },
  };
}
