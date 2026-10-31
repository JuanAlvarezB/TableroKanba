// Vista del tablero (tablero.html): dibuja las columnas a partir del store y traduce lo que hace
// la persona (clic, arrastrar, teclado) en acciones del store. Guarda el estado propio de la
// vista: tarea en edición, menú de etiquetas abierto, filtro, arrastre y resaltados.
import { WIP_LIMITS, countByStatus, filtersFor, isColumnFull } from '../../../domain/rules/board.js';
import { sortForView } from '../../../domain/rules/priority.js';
import { adjacentStatus } from '../../../domain/usecases/MoveTask.js';
import { createTaskCard } from '../../components/TaskCard.js';
import { currentFeatures } from '../../state/features.js';
import { createAlertsController } from './alertsController.js';
import { createBoardNotices } from './boardNotices.js';
import { createDragController } from './dragController.js';
import { createEditingController } from './editingController.js';
import { createHighlights } from './highlights.js';
import { createLabelMenuController } from './labelMenuController.js';

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {ReturnType<typeof import('../../../data/repositories/ReminderStore.js').createReminderStore>} deps.reminders
 */
export function createBoardPage({ store, reminders }) {
  const taskForm = document.getElementById('task-form');
  const taskInput = document.getElementById('task-input');
  const taskCount = document.getElementById('task-count');
  const allDoneMessage = document.getElementById('all-done-message');
  const clearCompletedBtn = document.getElementById('clear-completed');
  const lists = document.querySelectorAll('.task-list');
  const filterButtons = document.querySelectorAll('.filter-btn');

  const notices = createBoardNotices({
    boardNotice: document.getElementById('board-notice'),
    toast: document.getElementById('toast'),
    syncStatus: document.getElementById('sync-status'),
  });

  let activeFilter = 'all';
  const highlights = createHighlights();

  const tasks = () => store.tasks;
  const { showNotice } = notices;
  const labelMenu = createLabelMenuController({
    render,
    beforeToggle: () => {
      if (editor.active) editor.commit();
    },
  });
  const editor = createEditingController({ store, showNotice, render, beforeStart: () => labelMenu.forget() });
  const drag = createDragController({ store, lists });
  const alerts = createAlertsController({
    store,
    reminders,
    highlights,
    render,
    isDragging: () => drag.isDragging,
    filter: { current: () => activeFilter, showAll: () => setFilter('all') },
  });

  /* ---------- Filtro ---------- */

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
    render();
  }

  /* ---------- Acciones de la tarjeta ---------- */

  function shiftTask(id, direction) {
    const task = tasks().find((t) => t.id === id);
    if (!task) return;
    const nextStatus = adjacentStatus(task, direction);
    if (nextStatus) store.move(id, nextStatus);
  }

  function deleteTask(id) {
    editor.discard([id]);
    labelMenu.forget(id);
    store.delete(id);
  }

  function clearCompleted() {
    const completedIds = tasks()
      .filter((t) => t.status === 'completed')
      .map((t) => t.id);
    editor.discard(completedIds);
    store.clearCompleted();
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

  function createCard(task) {
    const editorCard = editor.cardFor(task);
    if (editorCard) return editorCard;
    return createTaskCard(task, {
      menuOpen: labelMenu.isOpen(task.id),
      highlightElapsed: highlights.elapsed(task.id),
      actions: cardActions,
    });
  }

  /* ---------- Dibujar ---------- */

  function render() {
    const all = tasks();
    editor.reconcile(all);
    labelMenu.reconcile(all);
    const restoreMenuFocus = labelMenu.preserveFocus();

    const restoreEditorFocus = editor.preserveFocus();

    lists.forEach((list) => {
      const status = list.dataset.status;
      list.innerHTML = '';

      const columnTasks = all.filter((t) => t.status === status);
      const visibleTasks = sortForView(
        columnTasks.filter(filtersFor(currentFeatures())[activeFilter]),
        currentFeatures(),
      );
      if (visibleTasks.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = columnTasks.length === 0 ? 'Sin tareas' : 'Sin tareas con este filtro';
        list.appendChild(empty);
      } else {
        visibleTasks.forEach((task) => list.appendChild(createCard(task)));
      }

      const counter = document.querySelector(`[data-count="${status}"]`);
      const limit = WIP_LIMITS[status];
      counter.textContent = limit ? `${columnTasks.length} · máx. ${limit}` : columnTasks.length;
      list.closest('.column').classList.toggle('full', isColumnFull(all, status));
    });

    const openCount = all.filter((t) => t.status !== 'completed').length;
    taskCount.textContent = `${openCount} tarea${openCount === 1 ? '' : 's'} sin completar`;

    clearCompletedBtn.disabled = countByStatus(all, 'completed') === 0;
    alerts.render();

    const allCompleted = all.length > 0 && openCount === 0;
    allDoneMessage.classList.toggle('hidden', !allCompleted);

    restoreEditorFocus();
    restoreMenuFocus();
  }

  /* ---------- Eventos ---------- */

  store.on('change', render);
  store.on('notice', showNotice);
  store.on('highlight', highlights.highlight);
  store.on('added', notices.announceNewTasks);
  store.on('edited', notices.announceEditedTasks);
  store.on('sync', notices.setSyncStatus);

  drag.listen();

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

  labelMenu.listen();

  alerts.listen();

  // Sin conexión a Firestore, sincroniza al menos las pestañas del mismo navegador.
  window.addEventListener('storage', (event) => store.reloadFromStorage(event.key));

  return { render };
}
