// Vista del tablero (tablero.html): dibuja las columnas a partir del store y traduce lo que hace
// la persona (clic, arrastrar, teclado) en acciones del store. Guarda el estado propio de la
// vista: tarea en edición, menú de etiquetas abierto, filtro, arrastre y resaltados.
import { FILTERS, WIP_LIMITS, countByStatus, isColumnFull } from '../../../domain/rules/board.js';
import { sortByPriority } from '../../../domain/rules/priority.js';
import { stalledDays } from '../../../domain/rules/stalledTasks.js';
import { adjacentStatus } from '../../../domain/usecases/MoveTask.js';
import { checkReminder } from '../../../domain/usecases/CheckReminder.js';
import { createFlasher } from '../../components/FlashMessage.js';
import { attentionGroups, createReminderBanner, renderColumnChips } from '../../components/OverdueAlerts.js';
import { createTaskCard, isEditable } from '../../components/TaskCard.js';
import { autoResize, getEditorCard } from '../../components/TaskEditor.js';
import { dueInfo } from '../../format/dates.js';

// Tarjetas resaltadas tras un cambio (id → momento de inicio), para que el resaltado no se
// reinicie aunque el tablero se vuelva a dibujar mientras dura la animación.
const HIGHLIGHT_DURATION = 1600;

const SYNC_LABELS = {
  connecting: 'Conectando…',
  online: 'Sincronizado',
  offline: 'Solo en este dispositivo',
};

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
  const boardNotice = document.getElementById('board-notice');
  const toast = document.getElementById('toast');
  const syncStatus = document.getElementById('sync-status');
  const lists = document.querySelectorAll('.task-list');
  const filterButtons = document.querySelectorAll('.filter-btn');

  const flash = createFlasher();
  const banner = createReminderBanner(
    {
      banner: document.getElementById('overdue-banner'),
      title: document.getElementById('overdue-title'),
      summary: document.getElementById('overdue-summary'),
      dismiss: document.getElementById('overdue-dismiss'),
    },
    { onShowTasks: showTasks },
  );

  /** @type {import('../../components/TaskEditor.js').Editing | null} */
  let editing = null;
  // Tarea con el menú de etiquetas abierto; null si no hay ninguno.
  let labelMenuId = null;
  let activeFilter = 'all';
  let draggedId = null;
  const highlights = new Map();
  // Firma de las alertas dibujadas; si cambia (pasa un día, una tarea supera el límite) hay
  // que volver a dibujar el tablero.
  let lastOverdueSignature = '';

  const tasks = () => store.tasks;
  const showNotice = (message) => flash(boardNotice, message);

  /* ---------- Avisos ---------- */

  function announceNewTasks(newTasks) {
    flash(
      toast,
      newTasks.length === 1
        ? `Se agregó una nueva tarea: "${newTasks[0].text}"`
        : `Se agregaron ${newTasks.length} tareas nuevas`,
    );
  }

  function announceEditedTasks(editedTasks) {
    flash(
      toast,
      editedTasks.length === 1
        ? `Se actualizó una tarea: "${editedTasks[0].text}"`
        : `Se actualizaron ${editedTasks.length} tareas`,
    );
  }

  function highlight(ids) {
    const now = performance.now();
    ids.forEach((id) => highlights.set(id, now));
  }

  // ms desde que empezó el resaltado de la tarjeta, o null si no tiene (o ya terminó).
  function highlightElapsed(id) {
    const start = highlights.get(id);
    if (start === undefined) return null;
    const elapsed = performance.now() - start;
    if (elapsed < HIGHLIGHT_DURATION) return elapsed;
    highlights.delete(id);
    return null;
  }

  function setSyncStatus(state) {
    syncStatus.dataset.state = state;
    syncStatus.textContent = SYNC_LABELS[state];
  }

  /* ---------- Filtro y menú de etiquetas ---------- */

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
    render();
  }

  function toggleLabelMenu(id) {
    if (editing) commitEdit();
    labelMenuId = labelMenuId === id ? null : id;
    render();
    if (labelMenuId === null) return;
    const menu = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .label-menu`);
    if (!menu) return;
    menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const current = menu.querySelector('[aria-pressed="true"]') || menu.querySelector('button');
    if (current) current.focus({ preventScroll: true });
  }

  // restoreFocus devuelve el foco al botón de etiquetas (teclado).
  function closeLabelMenu(restoreFocus = false) {
    if (labelMenuId === null) return;
    const id = labelMenuId;
    labelMenuId = null;
    render();
    if (!restoreFocus) return;
    const button = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .label-btn`);
    if (button) button.focus({ preventScroll: true });
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
    const slot = checkReminder(tasks(), { lastShownId: reminders.lastShown() });
    if (!slot) return;
    reminders.markShown(slot.id);
    banner.show(slot);
  }

  // Lleva a las tareas indicadas y las resalta; si el filtro las oculta, se muestran todas.
  function showTasks(ids) {
    if (ids.length === 0) return;
    highlight(ids);
    const visible = tasks()
      .filter((t) => ids.includes(t.id))
      .every(FILTERS[activeFilter]);
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

  /* ---------- Edición de tareas ---------- */

  function startEdit(id) {
    if (editing) {
      if (editing.id === id) return;
      commitEdit();
    }
    const task = tasks().find((t) => t.id === id);
    if (!task || !isEditable(task)) return;
    labelMenuId = null;

    editing = { id, original: task.text };
    render();

    const { textarea, element } = editing;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Guarda el texto editado. restoreFocus devuelve el foco al botón de editar (teclado).
  function commitEdit(restoreFocus = false) {
    if (!editing) return;
    const { id, textarea } = editing;
    const text = textarea.value.trim();
    editing = null;

    const task = tasks().find((t) => t.id === id);
    if (task && !isEditable(task)) {
      showNotice('Las tareas completadas no se pueden modificar.');
      render();
    } else if (task && !text) {
      showNotice('Una tarea no puede quedar vacía: se mantuvo el texto anterior.');
      render();
    } else if (task && text !== task.text) {
      store.editText(id, text);
    } else {
      render();
    }
    if (restoreFocus) focusEditButton(id);
  }

  function cancelEdit(restoreFocus = false) {
    if (!editing) return;
    const { id } = editing;
    editing = null;
    render();
    if (restoreFocus) focusEditButton(id);
  }

  function focusEditButton(id) {
    const button = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .edit-btn`);
    if (button) button.focus({ preventScroll: true });
  }

  /* ---------- Acciones de la tarjeta ---------- */

  function shiftTask(id, direction) {
    const task = tasks().find((t) => t.id === id);
    if (!task) return;
    const nextStatus = adjacentStatus(task, direction);
    if (nextStatus) store.move(id, nextStatus);
  }

  function deleteTask(id) {
    if (editing && editing.id === id) editing = null;
    if (labelMenuId === id) labelMenuId = null;
    store.delete(id);
  }

  function clearCompleted() {
    const completedIds = tasks()
      .filter((t) => t.status === 'completed')
      .map((t) => t.id);
    if (editing && completedIds.includes(editing.id)) editing = null;
    store.clearCompleted();
  }

  const cardActions = {
    startEdit,
    shift: shiftTask,
    toggleLabelMenu,
    remove: deleteTask,
    setPriority: (id, priority) => store.setPriority(id, priority),
    setDueDate: (id, dueDate) => store.setDueDate(id, dueDate),
    closeLabelMenu,
    dragStart: (id) => {
      draggedId = id;
    },
    dragEnd: () => {
      draggedId = null;
      lists.forEach((list) => list.classList.remove('drag-over'));
    },
  };

  const editorHandlers = { onCommit: commitEdit, onCancel: cancelEdit, getEditing: () => editing };

  function createCard(task) {
    if (editing && editing.id === task.id) return getEditorCard(task, editing, editorHandlers);
    return createTaskCard(task, {
      menuOpen: labelMenuId === task.id,
      highlightElapsed: highlightElapsed(task.id),
      actions: cardActions,
    });
  }

  /* ---------- Dibujar ---------- */

  function render() {
    const all = tasks();
    if (editing && !all.some((t) => t.id === editing.id)) {
      editing = null;
      showNotice('La tarea que estabas editando se eliminó en otro dispositivo.');
    } else if (editing && !isEditable(all.find((t) => t.id === editing.id))) {
      editing = null;
      showNotice(
        'La tarea que estabas editando se marcó como completada en otro dispositivo; ya no se puede modificar.',
      );
    }
    const menuTask = all.find((t) => t.id === labelMenuId);
    if (labelMenuId !== null && (!menuTask || !isEditable(menuTask))) labelMenuId = null;
    // Control del menú de etiquetas con el foco, para devolvérselo tras redibujar.
    const menuFocusKey = document.activeElement?.closest?.('.label-menu')
      ? document.activeElement.dataset.menuKey
      : null;

    // Al vaciar las listas el editor sale del documento y pierde el foco; se guarda para devolverlo.
    const focused =
      editing && editing.element && editing.element.contains(document.activeElement) ? document.activeElement : null;
    const selection = focused === editing?.textarea ? [focused.selectionStart, focused.selectionEnd] : null;

    lists.forEach((list) => {
      const status = list.dataset.status;
      list.innerHTML = '';

      const columnTasks = all.filter((t) => t.status === status);
      const visibleTasks = sortByPriority(columnTasks.filter(FILTERS[activeFilter]));
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

    if (editing) {
      autoResize(editing.textarea);
      if (focused) focused.focus({ preventScroll: true });
      if (selection) editing.textarea.setSelectionRange(...selection);
    }
    if (menuFocusKey && labelMenuId !== null) {
      const control = document.querySelector(`.label-menu [data-menu-key="${menuFocusKey}"]`);
      if (control) control.focus({ preventScroll: true });
    }
  }

  /* ---------- Eventos ---------- */

  store.on('change', render);
  store.on('notice', showNotice);
  store.on('highlight', highlight);
  store.on('added', announceNewTasks);
  store.on('edited', announceEditedTasks);
  store.on('sync', setSyncStatus);

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

  // Un clic fuera del menú de etiquetas lo cierra.
  document.addEventListener('click', (event) => {
    if (labelMenuId !== null && !event.target.closest('.label-menu, .label-btn')) closeLabelMenu();
  });

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
// tarea queda al principio o al final del suyo.
function getCardAfterCursor(list, y, priority) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')].filter(
    (card) => card.dataset.priority === (priority ?? ''),
  );
  return cards.find((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}
