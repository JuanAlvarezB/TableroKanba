// Barra del tablero: el formulario de tarea nueva, los filtros rápidos y el botón "Borrar completadas"
// (con confirmación). Parte de la vista del tablero (BoardPage.js).
import { countByStatus, filtersFor } from '../../../domain/rules/board.js';
import { subtasksOf } from '../../../domain/rules/subtasks.js';
import { BOARD_MESSAGES } from '../../../shared/constants/messages.js';
import { currentFeatures } from '../../state/features.js';

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {() => void} deps.render
 * @param {(ids: string[]) => void} deps.beforeClear Se llama con las completadas antes de borrarlas
 *   (deja de editar la que se esté editando).
 * @param {ReturnType<typeof import('../../components/BoardConfirm.js').createBoardConfirm>} deps.confirmAction
 * @param {(message: string) => void} deps.showNotice
 */
export function createToolbarController({ store, render, beforeClear, confirmAction, showNotice }) {
  const taskForm = document.getElementById('task-form');
  const taskInput = document.getElementById('task-input');
  const clearCompletedBtn = document.getElementById('clear-completed');
  const filterButtons = document.querySelectorAll('.filter-btn');

  let activeFilter = 'all';

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
    render();
  }

  const completedCount = () => countByStatus(store.tasks, 'completed');
  const completedHaveSubtasks = () => store.tasks.some((t) => t.status === 'completed' && subtasksOf(t).length > 0);

  // Dice cuántas completadas se borrarán y solo las borra al confirmar. La cantidad sigue al tablero
  // mientras el diálogo está abierto: se borra lo que dice (docs/PLAN_SUBTAREAS.md, 1.5).
  function clearCompleted() {
    const count = completedCount();
    if (count === 0) return;
    const copy = BOARD_MESSAGES.clearCompleted;
    confirmAction({
      title: copy.title,
      text: copy.text(count, completedHaveSubtasks()),
      warning: BOARD_MESSAGES.irreversible,
      confirmLabel: copy.confirm,
      icon: '🗑️',
      tone: 'danger',
      opener: clearCompletedBtn,
      onConfirm: () => {
        const completedIds = store.tasks.filter((t) => t.status === 'completed').map((t) => t.id);
        if (completedIds.length === 0) return;
        beforeClear(completedIds);
        store.clearCompleted();
        showNotice(copy.done(completedIds.length));
      },
      refresh: () => {
        const current = completedCount();
        return current > 0 ? { text: copy.text(current, completedHaveSubtasks()) } : null;
      },
      gone: copy.gone,
      // El botón queda deshabilitado: el foco va al título de la columna Completada.
      focusAfter: () => document.querySelector('.column[data-status="completed"] h2'),
    });
  }

  return {
    get activeFilter() {
      return activeFilter;
    },

    setFilter,

    // Filtro activo con los permisos de la persona (el de una función apagada muestra todo).
    visibleFilter() {
      return filtersFor(currentFeatures())[activeFilter];
    },

    // Parte de render(): sin completadas, el botón queda deshabilitado.
    render(all) {
      clearCompletedBtn.disabled = countByStatus(all, 'completed') === 0;
    },

    listen() {
      taskForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = taskInput.value.trim();
        if (text) {
          store.add(text);
          taskInput.value = '';
          taskInput.focus();
        }
      });

      clearCompletedBtn.addEventListener('click', clearCompleted);
      filterButtons.forEach((btn) => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));
    },
  };
}
