// Completar una tarea con subtareas desde la tarjeta (docs/PLAN_SUBTAREAS.md, 2.5): las flechas y el
// arrastre a Completada piden confirmar si todas sus subtareas están terminadas, y muestran qué falta si
// queda alguna pendiente (el store lo avisa con el evento blocked). Las tareas sin subtareas se mueven como
// siempre, sin pasos. El botón "Completar tarea" del diálogo de subtareas es la acción explícita y no pasa
// por aquí. Parte de la vista del tablero (BoardPage.js).
import { completionBlock, subtasksOf } from '../../../domain/rules/subtasks.js';
import { BOARD_MESSAGES } from '../../../shared/constants/messages.js';
import { clipText } from '../../format/labels.js';

const TEXT = BOARD_MESSAGES.subtasks;
// Subtareas pendientes que se nombran en el aviso; el resto se resume ("y 3 más").
const PENDING_SHOWN = 5;

const chipOf = (id) => document.querySelector(`.card[data-id="${CSS.escape(id)}"] .subtasks-btn`);

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {ReturnType<typeof import('../../components/BoardConfirm.js').createBoardConfirm>} deps.confirmAction
 * @param {ReturnType<typeof import('../../components/SubtaskDialog.js').createSubtaskDialog>} deps.subtaskDialog
 */
export function createCompletionController({ store, confirmAction, subtaskDialog }) {
  const findTask = (id) => store.tasks.find((t) => t.id === id);
  // Control que pidió el movimiento, para el aviso de bloqueo (blocked llega durante store.move).
  let mover = null;

  // Aún se puede completar con confirmación: existe, no está completada, tiene subtareas y están todas.
  const readyToConfirm = (task) =>
    Boolean(task) && task.status !== 'completed' && subtasksOf(task).length > 0 && !completionBlock(task);

  function askComplete(task, beforeId, opener) {
    const copy = TEXT.completeConfirm;
    const { id } = task;
    const describe = (current) => copy.text(clipText(current.text), subtasksOf(current).length);
    confirmAction({
      title: copy.title,
      text: describe(task),
      confirmLabel: copy.confirm,
      icon: '✓',
      tone: 'primary',
      opener,
      onConfirm: () => store.move(id, 'completed', beforeId),
      refresh: () => {
        const latest = findTask(id);
        return readyToConfirm(latest) ? { text: describe(latest) } : null;
      },
      gone: copy.gone,
      focusAfter: () => chipOf(id),
    });
  }

  // Qué falta para completarla, con "Ver subtareas" para abrir su lista.
  function showBlocked({ id, open, total, pending }, opener) {
    const task = findTask(id);
    if (!task) return;
    const copy = TEXT.blocked;
    const named = pending.slice(0, PENDING_SHOWN).map((text) => clipText(text));
    const items = pending.length > PENDING_SHOWN ? [...named, copy.more(pending.length - PENDING_SHOWN)] : named;
    confirmAction({
      title: copy.title,
      text: copy.text(clipText(task.text), open, total),
      items,
      warning: null,
      confirmLabel: copy.confirm,
      icon: '',
      cancelLabel: TEXT.close,
      tone: 'primary',
      opener,
      onConfirm: () => {},
      // Si mientras tanto se terminaron (otro dispositivo), el aviso sobra.
      refresh: () => {
        const latest = findTask(id);
        const block = latest && latest.status !== 'completed' ? completionBlock(latest) : null;
        return block ? { text: copy.text(clipText(latest.text), block.open, block.total) } : null;
      },
      focusAfter: (confirmed) => (confirmed ? null : chipOf(id)),
      // La lista se abre con este diálogo ya cerrado, para que el foco quede dentro de ella.
      afterClose: (confirmed) => {
        if (confirmed && findTask(id)) subtaskDialog.open(id, chipOf(id));
      },
    });
  }

  store.on('blocked', (payload) => showBlocked(payload, mover));

  return {
    /**
     * Mueve la tarea como store.move, pero a Completada con subtareas pide confirmar o explica qué falta.
     * @param {string} id
     * @param {import('../../../domain/entities/Task.js').Status} status
     * @param {string | null} [beforeId]
     * @param {HTMLElement | null} [opener] Control que lo pidió (la flecha); null al arrastrar.
     */
    move(id, status, beforeId = null, opener = null) {
      const task = findTask(id);
      if (!task) return;
      if (status === 'completed' && readyToConfirm(task)) {
        askComplete(task, beforeId, opener);
        return;
      }
      mover = opener;
      store.move(id, status, beforeId);
      mover = null;
    },
  };
}
