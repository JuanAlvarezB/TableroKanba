// Vista del tablero (tablero.html): dibuja las columnas a partir del store y traduce lo que hace
// la persona (clic, arrastrar, teclado) en acciones del store. Guarda el estado propio de la
// vista: tarea en edición, menú de etiquetas abierto, filtro, arrastre y resaltados.
import { WIP_LIMITS, countByStatus, filtersFor, isColumnFull } from '../../../domain/rules/board.js';
import { sortForView } from '../../../domain/rules/priority.js';
import { stalledDays } from '../../../domain/rules/stalledTasks.js';
import { adjacentStatus } from '../../../domain/usecases/MoveTask.js';
import { checkReminder } from '../../../domain/usecases/CheckReminder.js';
import { attentionGroups, createReminderBanner, renderColumnChips } from '../../components/OverdueAlerts.js';
import { createTaskCard } from '../../components/TaskCard.js';
import { dueInfo } from '../../format/dates.js';
import { currentFeatures } from '../../state/features.js';
import { createBoardNotices } from './boardNotices.js';
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
  const banner = createReminderBanner(
    {
      banner: document.getElementById('overdue-banner'),
      title: document.getElementById('overdue-title'),
      summary: document.getElementById('overdue-summary'),
      dismiss: document.getElementById('overdue-dismiss'),
    },
    { onShowTasks: showTasks },
  );

  let activeFilter = 'all';
  let draggedId = null;
  const highlights = createHighlights();
  // Firma de las alertas dibujadas; si cambia (pasa un día, una tarea supera el límite) hay
  // que volver a dibujar el tablero.
  let lastOverdueSignature = '';

  const tasks = () => store.tasks;
  const { showNotice } = notices;
  const labelMenu = createLabelMenuController({
    render,
    beforeToggle: () => {
      if (editor.active) editor.commit();
    },
  });
  const editor = createEditingController({ store, showNotice, render, beforeStart: () => labelMenu.forget() });

  /* ---------- Filtro ---------- */

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
    render();
  }

  /* ---------- Alertas y recordatorio ---------- */

  function overdueSignature() {
    return tasks()
      .map((t) => `${t.id}:${stalledDays(t)}:${dueInfo(t)?.text}`)
      .join('|');
  }

  // Muestra el recordatorio si toca turno, no se ha mostrado aún y hay tareas que lo necesitan.
  // Espera a que la pestaña esté visible para que el minuto en pantalla no pase sin verse.
  function showReminderIfDue() {
    if (document.visibilityState !== 'visible') return;
    const slot = checkReminder(tasks(), { lastShownId: reminders.lastShown(), features: currentFeatures() });
    if (!slot) return;
    reminders.markShown(slot.id);
    banner.show(slot);
  }

  // Lleva a las tareas indicadas y las resalta; si el filtro las oculta, se muestran todas.
  function showTasks(ids) {
    if (ids.length === 0) return;
    highlights.highlight(ids);
    const visible = tasks()
      .filter((t) => ids.includes(t.id))
      .every(filtersFor(currentFeatures())[activeFilter]);
    if (visible) render();
    else setFilter('all');
    const card = document.querySelector(`.card[data-id="${CSS.escape(ids[0])}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderOverdueAlerts() {
    lastOverdueSignature = overdueSignature();
    renderColumnChips(tasks());
    const groups = attentionGroups(tasks());
    banner.renderSummary(groups);
    // Si mientras se muestra se resuelve todo lo pendiente, el aviso sobra.
    if (groups.length === 0) banner.hide();
    else showReminderIfDue();
  }

  // Revisa con la página abierta si alguna tarea superó el límite, si cambió el día o si
  // empezó un turno de recordatorio. No se redibuja mientras se arrastra una tarjeta.
  function refreshOverdue() {
    if (draggedId === null && overdueSignature() !== lastOverdueSignature) render();
    showReminderIfDue();
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
    dragStart: (id) => {
      draggedId = id;
    },
    dragEnd: () => {
      draggedId = null;
      lists.forEach((list) => list.classList.remove('drag-over'));
    },
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
    renderOverdueAlerts();

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

      const dragged = tasks().find((t) => t.id === draggedId);
      if (!dragged) return;
      const afterCard = getCardAfterCursor(list, event.clientY, dragged.priority);
      const beforeId = afterCard ? afterCard.dataset.id : null;
      store.move(draggedId, list.dataset.status, beforeId);
    });
  });

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

  setInterval(refreshOverdue, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOverdue();
  });

  // Sin conexión a Firestore, sincroniza al menos las pestañas del mismo navegador.
  window.addEventListener('storage', (event) => store.reloadFromStorage(event.key));

  return { render };
}

// Devuelve la tarjeta del mismo grupo de etiqueta situada justo debajo del cursor, para
// insertar antes de ella. Arrastrar no cambia la etiqueta: si se suelta en otro grupo, la
// tarea queda al principio o al final del suyo. Con la función priorities apagada no hay
// grupos: la columna sigue solo el orden manual (docs/PLAN_USUARIOS.md, 3.1).
function getCardAfterCursor(list, y, priority) {
  const grouped = currentFeatures().priorities;
  const cards = [...list.querySelectorAll('.card:not(.dragging)')].filter(
    (card) => !grouped || card.dataset.priority === (priority ?? ''),
  );
  return cards.find((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}
