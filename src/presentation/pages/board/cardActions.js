// Tarjetas del tablero: crea cada una (o su versión en edición) con las acciones que puede hacer la
// persona sobre ella: mover con las flechas, editar, etiquetar, borrar y arrastrar. Parte de la vista
// del tablero (BoardPage.js); la tarjeta la dibuja components/TaskCard.js.
import { adjacentStatus } from '../../../domain/usecases/MoveTask.js';
import { createTaskCard } from '../../components/TaskCard.js';

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {ReturnType<typeof import('./editingController.js').createEditingController>} deps.editor
 * @param {ReturnType<typeof import('./labelMenuController.js').createLabelMenuController>} deps.labelMenu
 * @param {ReturnType<typeof import('./dragController.js').createDragController>} deps.drag
 * @param {ReturnType<typeof import('./highlights.js').createHighlights>} deps.highlights
 * @returns {(task: import('../../../domain/entities/Task.js').Task) => HTMLLIElement}
 */
export function createCardFactory({ store, editor, labelMenu, drag, highlights }) {
  function shiftTask(id, direction) {
    const task = store.tasks.find((t) => t.id === id);
    if (!task) return;
    const nextStatus = adjacentStatus(task, direction);
    if (nextStatus) store.move(id, nextStatus);
  }

  function deleteTask(id) {
    editor.discard([id]);
    labelMenu.forget(id);
    store.delete(id);
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
