// Tablero de tareas de LUCAS (tablero.html).
import { APP_ENV } from './shared/config/firebase.config.js';
import { LUCAS_AUTH } from './auth.js';
import { LUCAS_CUENTA } from './cuenta.js';
import { createFirestoreTaskRepository } from './data/repositories/FirestoreTaskRepository.js';
import { createLocalTaskCache } from './data/repositories/LocalTaskCache.js';
import { createReminderStore } from './data/repositories/ReminderStore.js';
import { DUE_DATE_PATTERN, STATUSES, STATUS_DATE_FIELDS, missingDates, wasInProgress } from './domain/entities/Task.js';
import { FILTERS, WIP_LIMITS, countByStatus, isColumnFull, sortTasks } from './domain/rules/board.js';
import { DUE_SOON_BUSINESS_DAYS, dueStatus } from './domain/rules/dueDates.js';
import { sortByPriority } from './domain/rules/priority.js';
import { attentionIds } from './domain/rules/reminders.js';
import { STALLED_DAYS, stalledDays } from './domain/rules/stalledTasks.js';
import { addTask as addTaskCase } from './domain/usecases/AddTask.js';
import { checkReminder as checkReminderCase } from './domain/usecases/CheckReminder.js';
import { clearCompleted as clearCompletedCase, deleteTask as deleteTaskCase } from './domain/usecases/DeleteTasks.js';
import { migrateLocalTasks as migrateLocalTasksCase } from './domain/usecases/MigrateLocalTasks.js';
import { adjacentStatus, moveTask as moveTaskCase } from './domain/usecases/MoveTask.js';
import { setDueDate as setDueDateCase } from './domain/usecases/SetDueDate.js';
import { setPriority as setPriorityCase } from './domain/usecases/SetPriority.js';

// Copia local de las tareas de la persona (data/repositories/LocalTaskCache.js). Se crea al
// confirmar la sesión y se suelta al cerrarla.
let cache = null;

const STATUS_LABELS = { pending: 'Creada', 'in-progress': 'En curso', completed: 'Completada' };

// Textos de las alertas de tareas detenidas (la regla está en domain/rules/stalledTasks.js).
// "phrase" completa frases como "Lleva 4 días en Pendiente".
const OVERDUE_COLUMNS = {
  pending: { name: 'Pendiente', phrase: 'en Pendiente' },
  'in-progress': { name: 'En curso', phrase: 'en curso' },
};

// El aviso resumen es un recordatorio (turnos en domain/rules/reminders.js) que se cierra solo
// al minuto. Las etiquetas de las tarjetas y columnas siguen visibles todo el tiempo.
const REMINDER_DURATION = 60000;
// Último turno mostrado en este navegador, para no repetirlo al recargar o en otra pestaña.
const reminders = createReminderStore();

// Etiquetas de prioridad: opcionales, se ponen después de crear la tarea. El orden de este
// objeto es el de PRIORITY_LEVELS (domain/entities/Task.js).
const PRIORITIES = {
  urgent: { icon: '🔴', label: 'Urgente' },
  high: { icon: '⬆', label: 'Prioritaria' },
  low: { icon: '💤', label: 'Puede esperar' },
};

const taskForm = document.getElementById('task-form');
const taskInput = document.getElementById('task-input');
const taskCount = document.getElementById('task-count');
const allDoneMessage = document.getElementById('all-done-message');
const clearCompletedBtn = document.getElementById('clear-completed');
const boardNotice = document.getElementById('board-notice');
const toast = document.getElementById('toast');
const syncStatus = document.getElementById('sync-status');
const lists = document.querySelectorAll('.task-list');
const overdueBanner = document.getElementById('overdue-banner');
const overdueSummary = document.getElementById('overdue-summary');
const overdueDismissBtn = document.getElementById('overdue-dismiss');
const overdueTitle = document.getElementById('overdue-title');
const filterButtons = document.querySelectorAll('.filter-btn');

// Vacío hasta confirmar la sesión: antes no se muestra ninguna tarea (ver startBoard).
let tasks = [];
let draggedId = null;

// Tarea en edición: { id, original, element, textarea, note }; null si no se edita ninguna.
// El editor se reutiliza entre renders para no perder lo escrito cuando llegan cambios remotos.
let editing = null;

// Tarea con el menú de etiquetas abierto; null si no hay ninguno.
let labelMenuId = null;
let activeFilter = 'all';

// Tarjetas resaltadas tras un cambio (id → momento de inicio), para que el resaltado
// no se reinicie aunque el tablero se vuelva a dibujar mientras dura la animación.
const HIGHLIGHT_DURATION = 1600;
const highlights = new Map();

// Tareas en Firestore (data/repositories/FirestoreTaskRepository.js); null mientras se trabaja
// solo en este navegador.
let repository = null;

// Los avisos se ocultan solos tras este tiempo.
const MESSAGE_DURATION = 3000;
const messageTimeouts = new Map();

function loadTasks() {
  return sortTasks(cache.load());
}

// Completa las fechas que falten y las sincroniza; solo se escriben los campos ausentes,
// así no se pisan las fechas que otro dispositivo haya guardado.
// Se intenta una sola vez por tarea: si el servidor rechaza la escritura, Firestore la deshace
// y volvería a llegar la tarea sin fechas, lo que provocaría reintentos sin fin.
const backfilledIds = new Set();

function backfillDates() {
  const pending = tasks
    .filter((task) => !backfilledIds.has(task.id))
    .map((task) => [task, missingDates(task)])
    .filter(([, fields]) => Object.keys(fields).length > 0);
  if (pending.length === 0) return;

  pending.forEach(([task, fields]) => {
    if (repository) backfilledIds.add(task.id);
    Object.assign(task, fields);
    updateRemote(task.id, fields);
  });
  saveTasks();
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function saveTasks() {
  if (!cache) return;
  if (!cache.save(tasks)) showNotice('No se pudieron guardar los cambios en este navegador.');
}

// Muestra un mensaje en el elemento indicado y lo oculta pasados MESSAGE_DURATION ms.
function flashMessage(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(messageTimeouts.get(element));
  messageTimeouts.set(
    element,
    setTimeout(() => element.classList.add('hidden'), MESSAGE_DURATION),
  );
}

function showNotice(message) {
  flashMessage(boardNotice, message);
}

function announceNewTasks(newTasks) {
  const message =
    newTasks.length === 1
      ? `Se agregó una nueva tarea: "${newTasks[0].text}"`
      : `Se agregaron ${newTasks.length} tareas nuevas`;
  flashMessage(toast, message);
}

function announceEditedTasks(editedTasks) {
  const message =
    editedTasks.length === 1
      ? `Se actualizó una tarea: "${editedTasks[0].text}"`
      : `Se actualizaron ${editedTasks.length} tareas`;
  flashMessage(toast, message);
}

function highlight(ids) {
  const now = performance.now();
  ids.forEach((id) => highlights.set(id, now));
}

// Compara el tablero anterior con el nuevo: resalta las tarjetas que cambiaron de texto o
// columna en otro dispositivo y avisa de las ediciones de texto.
function notifyRemoteChanges(previousTasks) {
  const previous = new Map(previousTasks.map((t) => [t.id, t]));
  const changed = tasks.filter((t) => {
    const before = previous.get(t.id);
    return before && ['text', 'status', 'priority', 'dueDate'].some((field) => before[field] !== t[field]);
  });
  highlight(changed.map((t) => t.id));
  const edited = changed.filter((t) => previous.get(t.id).text !== t.text);
  if (edited.length > 0) announceEditedTasks(edited);
}

function addTask(text) {
  const result = addTaskCase(tasks, { id: createId(), text });
  tasks = result.tasks;
  saveTasks();
  saveRemote(result.task);
  render();
  announceNewTasks([result.task]);
}

// Mueve una tarea a otra columna; si se indica beforeId, la coloca antes de esa tarea.
function moveTask(id, status, beforeId = null) {
  const result = moveTaskCase(tasks, { id, status, beforeId });
  if (!result.ok) {
    if (result.reason === 'wip-limit') {
      showNotice(`Límite WIP alcanzado: termina una tarea "En curso" antes de empezar otra (máx. ${result.limit}).`);
    }
    return;
  }
  tasks = result.tasks;
  saveTasks();
  updateRemote(id, result.changes);
  render();
}

// Cambia solo los campos indicados, así no pisa lo que otro dispositivo cambie a la vez.
function updateTask(id, fields) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, fields);
  saveTasks();
  updateRemote(id, fields);
}

/* ---------- Etiquetas de prioridad y fecha límite ---------- */

// Al cambiar la etiqueta, la tarea pasa al final de su nuevo grupo.
function setPriority(id, priority) {
  const changes = setPriorityCase(tasks, { id, priority });
  if (!changes) return;
  updateTask(id, changes);
  sortTasks(tasks);
  highlight([id]);
  render();
}

function setDueDate(id, dueDate) {
  const changes = setDueDateCase(tasks, { id, dueDate });
  if (!changes) return;
  updateTask(id, changes);
  render();
}

// Vencimiento con sus textos ({ kind, text, title }), o null si no tiene fecha o ya se completó.
// La regla está en domain/rules/dueDates.js.
function dueInfo(task) {
  const status = dueStatus(task);
  if (!status) return null;
  const { kind, days, due } = status;
  const title = `Fecha límite: ${longDateFormat.format(due)}`;

  if (kind === 'overdue') return { kind, text: `⛔ Venció hace ${plural(-days, 'día', 'días')}`, title };
  if (kind === 'soon') {
    const text = days === 0 ? '⏳ Vence hoy' : days === 1 ? '⏳ Vence mañana' : `⏳ Vence en ${days} días`;
    return { kind, text, title };
  }
  return { kind, text: `📅 Vence el ${shortDateFormat.format(due)}`, title };
}

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

/* ---------- Alertas de tareas detenidas ---------- */

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Firma de las alertas actuales; si cambia (pasa un día, una tarea supera el límite)
// hay que volver a dibujar el tablero.
function overdueSignature() {
  return tasks.map((t) => `${t.id}:${stalledDays(t)}:${dueInfo(t)?.text}`).join('|');
}
let lastOverdueSignature = '';

// Muestra el recordatorio si toca turno, no se ha mostrado aún y hay tareas detenidas.
// Espera a que la pestaña esté visible para que el minuto en pantalla no pase sin verse.
function checkReminder() {
  if (document.visibilityState !== 'visible') return;
  const slot = checkReminderCase(tasks, { lastShownId: reminders.lastShown() });
  if (!slot) return;

  reminders.markShown(slot.id);
  showReminder(slot);
}

let reminderTimeout = null;

function showReminder(slot) {
  overdueTitle.textContent = `Recordatorio ${slot.label}: hay tareas que necesitan atención`;
  overdueBanner.classList.remove('hidden', 'counting');
  // Reinicia la barra de tiempo restante.
  void overdueBanner.offsetWidth;
  overdueBanner.classList.add('counting');
  clearTimeout(reminderTimeout);
  reminderTimeout = setTimeout(hideReminder, REMINDER_DURATION);
}

function hideReminder() {
  clearTimeout(reminderTimeout);
  overdueBanner.classList.add('hidden');
  overdueBanner.classList.remove('counting');
}

// Grupos de tareas que el recordatorio menciona, con sus textos: detenidas por columna,
// urgentes, vencidas y próximas a vencer (la selección está en domain/rules/reminders.js).
// Solo se devuelven los que tienen alguna tarea.
function attentionGroups() {
  const { stalled, urgent, overdueDue, soonDue } = attentionIds(tasks);
  const groups = Object.entries(OVERDUE_COLUMNS).map(([status, { name, phrase }]) => ({
    ids: stalled[status],
    text: `${plural(stalled[status].length, 'tarea lleva', 'tareas llevan')} más de ${STALLED_DAYS} días ${phrase}.`,
    label: `Ver tareas detenidas en ${name}`,
  }));
  groups.push(
    {
      ids: urgent,
      text: `${plural(urgent.length, 'tarea urgente', 'tareas urgentes')} sin completar.`,
      label: 'Ver tareas urgentes',
    },
    {
      ids: overdueDue,
      text: `${plural(overdueDue.length, 'tarea vencida', 'tareas vencidas')}.`,
      label: 'Ver tareas vencidas',
    },
    {
      ids: soonDue,
      text: `${plural(soonDue.length, 'tarea vence', 'tareas vencen')} en ${DUE_SOON_BUSINESS_DAYS} días hábiles o menos.`,
      label: 'Ver tareas próximas a vencer',
    },
  );
  return groups.filter((g) => g.ids.length > 0);
}

// Lleva a las tareas indicadas y las resalta; si el filtro las oculta, se muestran todas.
function showTasks(ids) {
  if (ids.length === 0) return;
  highlight(ids);
  const visible = tasks.filter((t) => ids.includes(t.id)).every(FILTERS[activeFilter]);
  if (visible) render();
  else setFilter('all');
  const card = document.querySelector(`.card[data-id="${CSS.escape(ids[0])}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Muestra un contador en el encabezado de la columna, o lo oculta si es cero.
function setColumnChip(selector, text, title, count) {
  const chip = document.querySelector(selector);
  if (!chip) return;
  chip.textContent = text;
  chip.title = title;
  chip.classList.toggle('hidden', count === 0);
}

function renderOverdueAlerts() {
  lastOverdueSignature = overdueSignature();

  Object.entries(OVERDUE_COLUMNS).forEach(([status, { phrase }]) => {
    const columnTasks = tasks.filter((t) => t.status === status);
    const overdue = columnTasks.filter((t) => stalledDays(t) !== null).length;
    const urgent = columnTasks.filter((t) => t.priority === 'urgent').length;
    const due = columnTasks.filter(FILTERS.due).length;
    setColumnChip(
      `[data-alert="${status}"]`,
      `⏰ ${overdue}`,
      `${plural(overdue, 'tarea lleva', 'tareas llevan')} más de ${STALLED_DAYS} días ${phrase}`,
      overdue,
    );
    setColumnChip(
      `[data-urgent="${status}"]`,
      `🔴 ${urgent}`,
      plural(urgent, 'tarea urgente', 'tareas urgentes'),
      urgent,
    );
    setColumnChip(
      `[data-due="${status}"]`,
      `⏳ ${due}`,
      `${plural(due, 'tarea vencida o', 'tareas vencidas o')} próximas a vencer`,
      due,
    );
  });

  const groups = attentionGroups();
  overdueSummary.innerHTML = '';
  groups.forEach(({ ids, text, label }) => {
    const item = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = text;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overdue-show';
    button.textContent = 'Ver';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => showTasks(ids));
    item.append(span, button);
    overdueSummary.append(item);
  });

  // Si mientras se muestra se resuelve todo lo pendiente, el aviso sobra.
  if (groups.length === 0) hideReminder();
  else checkReminder();
}

/* ---------- Edición de tareas ---------- */

// Las tareas completadas quedan cerradas: su texto ya no se puede modificar.
function isEditable(task) {
  return task.status !== 'completed';
}

function startEdit(id) {
  if (editing) {
    if (editing.id === id) return;
    commitEdit();
  }
  const task = tasks.find((t) => t.id === id);
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

  const task = tasks.find((t) => t.id === id);
  if (task && !isEditable(task)) {
    showNotice('Las tareas completadas no se pueden modificar.');
  } else if (task && !text) {
    showNotice('Una tarea no puede quedar vacía: se mantuvo el texto anterior.');
  } else if (task && text !== task.text) {
    updateTask(id, { text });
    highlight([id]);
  }
  render();
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

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function shiftTask(id, direction) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const nextStatus = adjacentStatus(task, direction);
  if (nextStatus) moveTask(id, nextStatus);
}

function deleteTask(id) {
  if (editing && editing.id === id) editing = null;
  if (labelMenuId === id) labelMenuId = null;
  const result = deleteTaskCase(tasks, { id });
  tasks = result.tasks;
  saveTasks();
  deleteRemote(result.removedIds);
  render();
}

function clearCompleted() {
  const result = clearCompletedCase(tasks);
  if (editing && result.removedIds.includes(editing.id)) editing = null;
  tasks = result.tasks;
  saveTasks();
  deleteRemote(result.removedIds);
  render();
}

/* ---------- Sincronización con Firestore ---------- */

function setSyncStatus(state) {
  const labels = {
    connecting: 'Conectando…',
    online: 'Sincronizado',
    offline: 'Solo en este dispositivo',
  };
  syncStatus.dataset.state = state;
  syncStatus.textContent = labels[state];
}

function handleSyncError(error) {
  console.error('Error de sincronización con Firestore:', error.cause ?? error);

  // La conexión funciona pero las reglas de seguridad rechazaron el cambio; Firestore lo
  // deshace solo y el tablero vuelve a mostrar lo que hay en el servidor.
  if (error.reason === 'permission-denied' && repository) {
    showNotice('El servidor rechazó el cambio (reglas de seguridad de Firestore). Revisa la consola para más detalle.');
    return;
  }

  if (syncStatus.dataset.state !== 'offline') {
    showNotice('No se pudo conectar con el servidor: los cambios solo se guardan en este dispositivo.');
  }
  setSyncStatus('offline');
}

function saveRemote(task) {
  if (!repository) return;
  repository.save(task).catch(handleSyncError);
}

function updateRemote(id, fields) {
  if (!repository) return;
  repository.update(id, fields).catch(handleSyncError);
}

function deleteRemote(ids) {
  if (!repository || ids.length === 0) return;
  repository.remove(ids).catch(handleSyncError);
}

// Conecta con Firestore y escucha los cambios de cualquier dispositivo, solo en las tareas de
// la persona. Sin conexión, Firestore sigue reintentando y el tablero funciona con la copia
// local mientras tanto. Antes sube, una sola vez, las tareas que solo estaban en este navegador.
function connectRemote(session) {
  setSyncStatus(session.offline ? 'offline' : 'connecting');
  repository = createFirestoreTaskRepository(session.firebase, session.uid);
  migrateLocalTasksCase({ tasks, cache, repository }).catch(handleSyncError);

  let firstSnapshot = true;
  const stopListening = repository.subscribe((snapshot) => {
    // Hasta recibir datos del servidor, la caché de Firestore está vacía o incompleta: si se
    // aplicara, borraría del tablero la copia local. Mientras tanto manda la copia local.
    if (firstSnapshot && snapshot.fromCache) return;

    const previousTasks = tasks;
    tasks = sortTasks(snapshot.tasks);
    backfillDates();
    saveTasks();
    // Los cambios propios ya están aplicados en previousTasks, así que solo se detectan los ajenos.
    if (!firstSnapshot) notifyRemoteChanges(previousTasks);
    render();
    setSyncStatus(snapshot.fromCache ? 'offline' : 'online');

    // Las tareas creadas en este navegador ya se anunciaron en addTask.
    if (!firstSnapshot && snapshot.added.length > 0) announceNewTasks(snapshot.added);
    firstSnapshot = false;
  }, handleSyncError);

  // Al cerrar la sesión se deja de escuchar y de escribir antes de borrar la copia local.
  LUCAS_AUTH.onSignOut(() => {
    stopListening();
    repository = null;
    cache = null;
  });
}

function createCard(task) {
  if (editing && editing.id === task.id) return getEditorCard(task);

  const li = document.createElement('li');
  li.className = `card ${task.status}`;
  // Con el menú de etiquetas abierto no se arrastra, para poder usar la fecha con el ratón.
  li.draggable = labelMenuId !== task.id;
  li.dataset.id = task.id;
  li.dataset.priority = task.priority ?? '';
  if (task.priority) li.classList.add(`priority-${task.priority}`);

  // El resaltado continúa donde iba aunque la tarjeta se haya vuelto a crear.
  const highlightStart = highlights.get(task.id);
  if (highlightStart !== undefined) {
    const elapsed = performance.now() - highlightStart;
    if (elapsed < HIGHLIGHT_DURATION) {
      li.classList.add('flash');
      li.style.animationDelay = `${-elapsed}ms`;
    } else {
      highlights.delete(task.id);
    }
  }

  li.addEventListener('dragstart', (event) => {
    draggedId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
    li.classList.add('dragging');
  });

  li.addEventListener('dragend', () => {
    draggedId = null;
    li.classList.remove('dragging');
    lists.forEach((list) => list.classList.remove('drag-over'));
  });

  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;
  if (isEditable(task)) {
    span.title = 'Doble clic para editar';
    span.addEventListener('dblclick', () => startEdit(task.id));
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const index = STATUSES.indexOf(task.status);

  const backBtn = document.createElement('button');
  backBtn.className = 'move-btn';
  backBtn.textContent = '←';
  backBtn.title = 'Mover a la columna anterior';
  backBtn.disabled = index === 0;
  backBtn.addEventListener('click', () => shiftTask(task.id, -1));

  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'move-btn';
  forwardBtn.textContent = '→';
  forwardBtn.title = 'Mover a la columna siguiente';
  forwardBtn.disabled = index === STATUSES.length - 1;
  forwardBtn.addEventListener('click', () => shiftTask(task.id, 1));

  const editBtn = document.createElement('button');
  editBtn.className = 'edit-btn';
  editBtn.textContent = '✏️';
  editBtn.title = 'Editar tarea';
  editBtn.setAttribute('aria-label', 'Editar tarea');
  editBtn.addEventListener('click', () => startEdit(task.id));

  const labelBtn = document.createElement('button');
  labelBtn.className = 'label-btn';
  labelBtn.textContent = '🏷️';
  labelBtn.title = 'Etiqueta y fecha límite';
  labelBtn.setAttribute('aria-label', 'Etiqueta y fecha límite');
  labelBtn.setAttribute('aria-expanded', String(labelMenuId === task.id));
  labelBtn.addEventListener('click', () => toggleLabelMenu(task.id));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Eliminar tarea';
  deleteBtn.setAttribute('aria-label', 'Eliminar tarea');
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  actions.append(backBtn, forwardBtn);
  if (isEditable(task)) actions.append(labelBtn, editBtn);
  actions.append(deleteBtn);

  const tags = createTags(task);
  if (tags) li.append(tags);

  const days = stalledDays(task);
  if (days !== null) {
    li.classList.add('overdue');
    const badge = document.createElement('p');
    badge.className = 'overdue-badge';
    badge.textContent = `⏰ Lleva ${days} días ${OVERDUE_COLUMNS[task.status].phrase}`;
    badge.title = `Supera el límite de ${STALLED_DAYS} días calendario`;
    li.append(badge);
  }

  li.append(span, createHistory(task), actions);
  if (labelMenuId === task.id) li.append(createLabelMenu(task));
  return li;
}

// Etiquetas de la tarjeta: prioridad y vencimiento (como máximo dos).
function createTags(task) {
  const due = dueInfo(task);
  if (!task.priority && !due) return null;

  const tags = document.createElement('div');
  tags.className = 'card-tags';
  if (task.priority) {
    const { icon, label } = PRIORITIES[task.priority];
    const tag = document.createElement('span');
    tag.className = `tag tag-${task.priority}`;
    tag.textContent = `${icon} ${label}`;
    tags.append(tag);
  }
  if (due) {
    const tag = document.createElement('span');
    tag.className = `tag tag-due-${due.kind}`;
    tag.textContent = due.text;
    tag.title = due.title;
    tags.append(tag);
  }
  return tags;
}

// Menú para poner, cambiar o quitar la etiqueta y la fecha límite de una tarea ya creada.
// data-menu-key permite devolver el foco al mismo control después de redibujar.
function createLabelMenu(task) {
  const menu = document.createElement('div');
  menu.className = 'label-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Etiqueta y fecha límite');
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLabelMenu(true);
    }
  });

  const title = document.createElement('p');
  title.className = 'label-menu-title';
  title.textContent = 'Prioridad';

  const options = document.createElement('div');
  options.className = 'label-options';
  [...Object.keys(PRIORITIES), null].forEach((priority) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `label-option tag tag-${priority ?? 'none'}`;
    option.dataset.menuKey = `priority-${priority ?? 'none'}`;
    option.textContent = priority ? `${PRIORITIES[priority].icon} ${PRIORITIES[priority].label}` : 'Sin etiqueta';
    option.setAttribute('aria-pressed', String(task.priority === priority));
    option.addEventListener('click', () => {
      setPriority(task.id, priority);
      closeLabelMenu(true);
    });
    options.append(option);
  });

  const dueLabel = document.createElement('label');
  dueLabel.className = 'label-menu-title';
  dueLabel.textContent = 'Fecha límite (opcional)';
  dueLabel.htmlFor = `due-${task.id}`;

  const dueRow = document.createElement('div');
  dueRow.className = 'label-due';

  const dueInput = document.createElement('input');
  dueInput.type = 'date';
  dueInput.id = `due-${task.id}`;
  dueInput.className = 'due-input';
  dueInput.value = task.dueDate ?? '';
  dueInput.dataset.menuKey = 'due';
  dueInput.addEventListener('change', () => {
    if (dueInput.value === '' || DUE_DATE_PATTERN.test(dueInput.value)) setDueDate(task.id, dueInput.value || null);
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'due-clear';
  clearBtn.textContent = 'Quitar';
  clearBtn.dataset.menuKey = 'due-clear';
  clearBtn.disabled = task.dueDate === null;
  clearBtn.addEventListener('click', () => {
    setDueDate(task.id, null);
    // El botón queda desactivado tras redibujar; el foco pasa al campo de fecha nuevo.
    const input = document.getElementById(dueInput.id);
    if (input) input.focus({ preventScroll: true });
  });

  dueRow.append(dueInput, clearBtn);
  menu.append(title, options, dueLabel, dueRow);
  return menu;
}

const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormatWithYear = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const shortDateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const longDateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full' });
const fullDateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });

// El año solo se muestra si no es el actual, para que la fecha ocupe poco en la tarjeta.
function formatDate(ms) {
  const date = new Date(ms);
  const format = date.getFullYear() === new Date().getFullYear() ? dateFormat : dateFormatWithYear;
  return format.format(date);
}

// Línea de tiempo con las fechas en que la tarea entró en cada estado, más la anotación
// de las tareas que volvieron de En curso a Pendiente.
function createHistory(task) {
  const list = document.createElement('ol');
  list.className = 'task-history';
  list.setAttribute('aria-label', 'Historial de estados');

  // Solo se muestran los estados alcanzados hasta la columna actual; la fecha de En curso de
  // una tarea devuelta a Pendiente se muestra aparte, como anotación.
  STATUSES.slice(0, STATUSES.indexOf(task.status) + 1).forEach((status) => {
    const ms = task[STATUS_DATE_FIELDS[status]];
    if (ms === null) return;

    const item = document.createElement('li');
    item.className = 'history-step';
    item.dataset.status = status;
    // Marca la fecha desde la que se cuenta la alerta de la tarea.
    if (status === task.status && stalledDays(task) !== null) item.classList.add('is-overdue');

    const label = document.createElement('span');
    label.className = 'history-label';
    label.textContent = STATUS_LABELS[status];

    const time = document.createElement('time');
    time.dateTime = new Date(ms).toISOString();
    time.title = fullDateFormat.format(ms);
    time.textContent = formatDate(ms);

    item.append(label, time);
    list.append(item);
  });

  if (!wasInProgress(task)) return list;

  const note = document.createElement('p');
  note.className = 'history-note';
  note.title = `Estuvo en curso desde el ${fullDateFormat.format(task.startedAt)} y luego volvió a Pendiente`;
  note.textContent = `↩ Ya estuvo en curso desde el ${shortDateFormat.format(task.startedAt)}`;

  const fragment = document.createDocumentFragment();
  fragment.append(list, note);
  return fragment;
}

// Devuelve la tarjeta en modo edición: se crea la primera vez y después se reutiliza,
// solo actualizando columna y texto si otro dispositivo los cambió.
function getEditorCard(task) {
  if (!editing.element) editing.element = createEditor(task);
  const { element, textarea, note } = editing;
  element.className = `card editing ${task.status}`;
  element.dataset.priority = task.priority ?? '';

  if (task.text !== editing.original) {
    if (textarea.value === editing.original) {
      // Sin cambios locales todavía: se adopta el texto nuevo sin molestar.
      textarea.value = task.text;
    } else {
      note.textContent = 'Otro dispositivo cambió esta tarea mientras la editabas. Si guardas, se usará tu versión.';
      note.classList.remove('hidden');
    }
    editing.original = task.text;
  }
  return element;
}

function createEditor(task) {
  const li = document.createElement('li');
  li.dataset.id = task.id;

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-input';
  textarea.value = task.text;
  textarea.rows = 1;
  textarea.maxLength = 500;
  textarea.setAttribute('aria-label', 'Texto de la tarea');
  textarea.addEventListener('input', () => autoResize(textarea));
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      commitEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit(true);
    }
  });

  const note = document.createElement('p');
  note.className = 'edit-note hidden';
  note.setAttribute('role', 'status');

  const bar = document.createElement('div');
  bar.className = 'edit-bar';

  const hint = document.createElement('span');
  hint.className = 'edit-hint';
  hint.textContent = 'Enter guarda · Esc cancela';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'edit-cancel';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', () => cancelEdit(true));

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'edit-save';
  saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', () => commitEdit(true));

  // Al pulsar los botones con ratón el foco se queda en el texto, así el clic decide la acción.
  [cancelBtn, saveBtn].forEach((btn) => btn.addEventListener('mousedown', (e) => e.preventDefault()));

  // Hacer clic fuera de la tarjeta guarda los cambios. Se espera un instante porque al
  // redibujar el tablero el editor pierde el foco y lo recupera enseguida, y al cambiar de
  // ventana el foco sigue en el texto: en ninguno de esos casos hay que guardar.
  li.addEventListener('focusout', () => {
    setTimeout(() => {
      if (editing && editing.element === li && !li.contains(document.activeElement)) commitEdit();
    });
  });

  bar.append(hint, cancelBtn, saveBtn);
  li.append(textarea, note, bar);
  Object.assign(editing, { textarea, note });
  return li;
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

function render() {
  if (editing && !tasks.some((t) => t.id === editing.id)) {
    editing = null;
    showNotice('La tarea que estabas editando se eliminó en otro dispositivo.');
  } else if (editing && !isEditable(tasks.find((t) => t.id === editing.id))) {
    editing = null;
    showNotice('La tarea que estabas editando se marcó como completada en otro dispositivo; ya no se puede modificar.');
  }
  const menuTask = tasks.find((t) => t.id === labelMenuId);
  if (labelMenuId !== null && (!menuTask || !isEditable(menuTask))) labelMenuId = null;
  // Control del menú de etiquetas con el foco, para devolvérselo tras redibujar.
  const menuFocusKey = document.activeElement?.closest?.('.label-menu') ? document.activeElement.dataset.menuKey : null;

  // Al vaciar las listas el editor sale del documento y pierde el foco; se guarda para devolverlo.
  const focused =
    editing && editing.element && editing.element.contains(document.activeElement) ? document.activeElement : null;
  const selection = focused === editing?.textarea ? [focused.selectionStart, focused.selectionEnd] : null;

  lists.forEach((list) => {
    const status = list.dataset.status;
    list.innerHTML = '';

    const columnTasks = tasks.filter((t) => t.status === status);
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
    list.closest('.column').classList.toggle('full', isColumnFull(tasks, status));
  });

  const openCount = tasks.filter((t) => t.status !== 'completed').length;
  taskCount.textContent = `${openCount} tarea${openCount === 1 ? '' : 's'} sin completar`;

  clearCompletedBtn.disabled = countByStatus(tasks, 'completed') === 0;
  renderOverdueAlerts();

  const allCompleted = tasks.length > 0 && openCount === 0;
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

    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;
    const afterCard = getCardAfterCursor(list, event.clientY, dragged.priority);
    const beforeId = afterCard ? afterCard.dataset.id : null;
    moveTask(draggedId, list.dataset.status, beforeId);
  });
});

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (text) {
    addTask(text);
    taskInput.value = '';
    taskInput.focus();
  }
});

clearCompletedBtn.addEventListener('click', clearCompleted);
overdueDismissBtn.addEventListener('click', hideReminder);
filterButtons.forEach((btn) => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));

// Un clic fuera del menú de etiquetas lo cierra.
document.addEventListener('click', (event) => {
  if (labelMenuId !== null && !event.target.closest('.label-menu, .label-btn')) closeLabelMenu();
});

// Revisa con la página abierta si alguna tarea superó el límite, si cambió el día o si
// empezó un turno de recordatorio. No se redibuja mientras se arrastra una tarjeta.
function refreshOverdue() {
  if (draggedId === null && overdueSignature() !== lastOverdueSignature) render();
  checkReminder();
}
setInterval(refreshOverdue, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshOverdue();
});

// Sin conexión a Firestore, sincroniza al menos las pestañas del mismo navegador.
// (key es null cuando la otra pestaña vacía todo el localStorage.)
window.addEventListener('storage', (event) => {
  if (!cache || repository || (event.key !== null && event.key !== cache.tasksKey)) return;
  const previousTasks = tasks;
  const knownIds = new Set(tasks.map((t) => t.id));
  tasks = loadTasks();
  notifyRemoteChanges(previousTasks);
  render();
  const newTasks = tasks.filter((t) => !knownIds.has(t.id));
  if (newTasks.length > 0) announceNewTasks(newTasks);
});

// Fuera de PDN se marca la página como Desarrollo, para no confundir las pruebas con el
// tablero real.
function showEnvironmentBadge() {
  if (APP_ENV.name !== 'dev') return;
  document.title = `[DEV] ${document.title}`;
  const badge = document.createElement('span');
  badge.className = 'env-badge';
  badge.textContent = 'DESARROLLO';
  document.querySelector('h1').append(' ', badge);
}

// El tablero solo carga tareas después de confirmar la sesión (auth.js): sin sesión lleva al
// login, y sin conexión ni autorización recordada muestra la pantalla de Reintentar.
async function startBoard() {
  const session = await LUCAS_AUTH.requireSession();
  cache = createLocalTaskCache({ tasksKey: session.storageKey, migratedKey: session.migratedKey });
  LUCAS_CUENTA.mount(session, document.getElementById('account'));

  tasks = loadTasks();
  backfillDates();
  render();
  connectRemote(session);
}

showEnvironmentBadge();
startBoard();
