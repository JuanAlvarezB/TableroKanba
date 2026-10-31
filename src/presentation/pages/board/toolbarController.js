// Barra del tablero: el formulario de tarea nueva, los filtros rápidos y el botón "Borrar completadas".
// Parte de la vista del tablero (BoardPage.js).
import { countByStatus, filtersFor } from '../../../domain/rules/board.js';
import { currentFeatures } from '../../state/features.js';

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {() => void} deps.render
 * @param {(ids: string[]) => void} deps.beforeClear Se llama con las completadas antes de borrarlas
 *   (deja de editar la que se esté editando).
 */
export function createToolbarController({ store, render, beforeClear }) {
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

  function clearCompleted() {
    const completedIds = store.tasks.filter((t) => t.status === 'completed').map((t) => t.id);
    beforeClear(completedIds);
    store.clearCompleted();
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
