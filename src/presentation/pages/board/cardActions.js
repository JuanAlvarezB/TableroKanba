// Tarjetas del tablero: crea cada una (o su versión en edición) con las acciones que puede hacer la
// persona sobre ella: mover con las flechas, editar, etiquetar, borrar (con confirmación) y arrastrar.
// Parte de la vista del tablero (BoardPage.js); la tarjeta la dibuja components/TaskCard.js.
import { adjacentStatus } from '../../../domain/usecases/MoveTask.js';
import { BOARD_MESSAGES } from '../../../shared/constants/messages.js';
import { createTaskCard } from '../../components/TaskCard.js';
import { clipText } from '../../format/labels.js';

const cardElement = (id) => document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
const cardControl = (id, selector) => cardElement(id)?.querySelector(selector) ?? null;

/**
 * A dónde va el foco al cerrar la confirmación de borrar una tarea (docs/PLAN_SUBTAREAS.md, 1.6): sin
 * confirmar, a su 🗑️ (el tablero pudo volver a dibujarla); confirmada o borrada en otro dispositivo, a la
 * tarjeta siguiente de su columna, o a la anterior, o al título de la columna si quedó vacía. Las
 * vecinas se anotan al abrir, antes de que la tarjeta desaparezca.
 */
function focusAfterDelete(id) {
  const list = cardElement(id)?.closest('.task-list') ?? null;
  const ids = list ? [...list.querySelectorAll('.card')].map((card) => card.dataset.id) : [];
  const index = ids.indexOf(id);
  const neighbors = index === -1 ? [] : [...ids.slice(index + 1), ...ids.slice(0, index).reverse()];
  const heading = list?.closest('.column')?.querySelector('h2') ?? null;
  return (confirmed) => {
    const own = confirmed ? null : cardControl(id, '.delete-btn');
    if (own) return own;
    for (const other of neighbors) {
      const control = cardControl(other, '.card-actions button:not(:disabled)');
      if (control) return control;
    }
    return heading;
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {ReturnType<typeof import('./editingController.js').createEditingController>} deps.editor
 * @param {ReturnType<typeof import('./labelMenuController.js').createLabelMenuController>} deps.labelMenu
 * @param {ReturnType<typeof import('./dragController.js').createDragController>} deps.drag
 * @param {ReturnType<typeof import('./highlights.js').createHighlights>} deps.highlights
 * @param {ReturnType<typeof import('../../components/BoardConfirm.js').createBoardConfirm>} deps.confirmAction
 * @param {(message: string) => void} deps.showNotice
 * @returns {(task: import('../../../domain/entities/Task.js').Task) => HTMLLIElement}
 */
export function createCardFactory({ store, editor, labelMenu, drag, highlights, confirmAction, showNotice }) {
  function shiftTask(id, direction) {
    const task = store.tasks.find((t) => t.id === id);
    if (!task) return;
    const nextStatus = adjacentStatus(task, direction);
    if (nextStatus) store.move(id, nextStatus);
  }

  const findTask = (id) => store.tasks.find((t) => t.id === id);

  // Pide confirmación nombrando la tarea; solo al confirmar se borra (docs/PLAN_SUBTAREAS.md, 1.4 y 1.5).
  function deleteTask(id) {
    const task = findTask(id);
    if (!task) return;
    const copy = BOARD_MESSAGES.deleteTask;
    confirmAction({
      title: copy.title,
      text: copy.text(clipText(task.text)),
      warning: BOARD_MESSAGES.irreversible,
      confirmLabel: copy.confirm,
      icon: '🗑️',
      tone: 'danger',
      opener: cardControl(id, '.delete-btn'),
      onConfirm: () => {
        const latest = findTask(id) ?? task;
        editor.discard([id]);
        labelMenu.forget(id);
        store.delete(id);
        showNotice(copy.done(clipText(latest.text)));
      },
      // Si otro dispositivo cambia el texto, se confirma lo que se ve; si la borra, el diálogo sobra.
      refresh: () => {
        const latest = findTask(id);
        return latest ? { text: copy.text(clipText(latest.text)) } : null;
      },
      gone: copy.gone,
      focusAfter: focusAfterDelete(id),
    });
  }

  const cardActions = {
    startEdit: editor.start,
    shift: shiftTask,
    toggleLabelMenu: labelMenu.toggle,
    remove: deleteTask,
    setPriority: (id, priority) => store.setPriority(id, priority),
    setDueDate: (id, dueDate) => store.setDueDate(id, dueDate),
    closeLabelMenu: labelMenu.close,
    dragStart: drag.start,
    dragEnd: drag.end,
  };

  return function createCard(task) {
    const editorCard = editor.cardFor(task);
    if (editorCard) return editorCard;
    return createTaskCard(task, {
      menuOpen: labelMenu.isOpen(task.id),
      highlightElapsed: highlights.elapsed(task.id),
      actions: cardActions,
    });
  };
}
