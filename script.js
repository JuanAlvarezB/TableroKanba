// Claves de localStorage del ambiente actual (config.js): PDN y Desarrollo no comparten tareas.
const STORAGE_KEY = APP_ENV.storageKey;
// Marca que las tareas guardadas solo en este navegador ya se subieron a Firestore.
const MIGRATED_KEY = APP_ENV.migratedKey;

// El proyecto de Firebase de cada ambiente está en config.js (APP_ENV.firebaseConfig).
const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/12.19.0';
const TASKS_COLLECTION = 'tasks';

// Columnas del tablero, en el orden del flujo de trabajo.
const STATUSES = ['pending', 'in-progress', 'completed'];

// Historial de fechas: cada estado guarda cuándo entró la tarea en él (milisegundos
// desde 1970, o null si aún no ha pasado por ese estado).
const STATUS_DATE_FIELDS = { pending: 'createdAt', 'in-progress': 'startedAt', completed: 'completedAt' };
const STATUS_LABELS = { pending: 'Creada', 'in-progress': 'En curso', completed: 'Completada' };

// Alertas de tareas detenidas: más de OVERDUE_DAYS días calendario en Pendiente (desde que se
// creó) o En curso (desde que empezó). Las completadas no generan alertas.
const OVERDUE_DAYS = 3;
// "phrase" completa frases como "Lleva 4 días en Pendiente".
const OVERDUE_COLUMNS = {
  pending: { name: 'Pendiente', phrase: 'en Pendiente' },
  'in-progress': { name: 'En curso', phrase: 'en curso' },
};

// El aviso resumen es un recordatorio: sale de lunes a viernes una vez en la mañana (desde
// las 10:00) y otra en la tarde (desde las 15:00), y se cierra solo al minuto. Las etiquetas
// de las tarjetas y columnas siguen visibles todo el tiempo.
const REMINDER_SLOTS = [
  { hour: 10, label: 'de la mañana' },
  { hour: 15, label: 'de la tarde' },
];
const REMINDER_DURATION = 60000;
// Último turno mostrado en este navegador, para no repetirlo al recargar o en otra pestaña.
const REMINDER_KEY = 'ultimo-recordatorio';

// Etiquetas de prioridad: opcionales, se ponen después de crear la tarea. El orden de este
// objeto es el orden de la columna; las tareas sin etiqueta van al final.
const PRIORITIES = {
  urgent: { icon: '🔴', label: 'Urgente' },
  high: { icon: '⬆', label: 'Prioritaria' },
  low: { icon: '💤', label: 'Puede esperar' },
};
const PRIORITY_RANK = Object.fromEntries(Object.keys(PRIORITIES).map((key, index) => [key, index]));
const NO_PRIORITY_RANK = Object.keys(PRIORITIES).length;

// Fecha límite opcional ("2026-10-15", día local). Se marca "próxima a vencer" cuando faltan
// DUE_SOON_BUSINESS_DAYS días hábiles o menos, y "vencida" cuando ya pasó.
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DUE_SOON_BUSINESS_DAYS = 2;

// Filtro rápido del tablero.
const FILTERS = {
  all: () => true,
  urgent: (t) => t.priority === 'urgent',
  high: (t) => t.priority === 'high',
  low: (t) => t.priority === 'low',
  none: (t) => t.priority === null,
  due: (t) => ['soon', 'overdue'].includes(dueInfo(t)?.kind),
};

// Límite de trabajo en curso (WIP) por columna. Kanban limita lo que está
// "en curso" para terminar tareas antes de empezar otras nuevas.
const WIP_LIMITS = { 'in-progress': 200 };

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

let tasks = loadTasks();
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

// Conexión con Firestore ({ db, fs }); null mientras se trabaja solo en este navegador.
let remote = null;

// Los avisos se ocultan solos tras este tiempo.
const MESSAGE_DURATION = 3000;
const messageTimeouts = new Map();

function loadTasks() {
  // localStorage puede lanzar error (Safari con datos de sitio bloqueados) o
  // contener datos corruptos; en ambos casos se empieza con el tablero vacío.
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) parsed = [];

  // Migra tareas guardadas con formatos anteriores ({ completed: boolean }, id numérico, sin orden).
  return sortTasks(
    parsed
      .filter((t) => t && typeof t.text === 'string')
      .map((t, index) => ({
        id: String(t.id),
        text: t.text,
        status: STATUSES.includes(t.status) ? t.status : t.completed ? 'completed' : 'pending',
        order: typeof t.order === 'number' ? t.order : index,
        ...readDates(t),
        ...readLabels(t),
      })),
  );
}

// Lee las fechas guardadas; las que falten quedan en null (backfillDates las completa).
function readDates(source) {
  const dates = {};
  Object.values(STATUS_DATE_FIELDS).forEach((field) => {
    dates[field] = Number.isFinite(source[field]) ? source[field] : null;
  });
  return dates;
}

// Lee la prioridad y la fecha límite; si no hay o no son válidas quedan en null (sin etiqueta).
function readLabels(source) {
  return {
    priority: Object.hasOwn(PRIORITIES, source.priority ?? '') ? source.priority : null,
    dueDate: typeof source.dueDate === 'string' && DUE_DATE_PATTERN.test(source.dueDate) ? source.dueDate : null,
  };
}

// Las tareas creadas antes de existir el historial reciben como fecha por defecto el momento
// en que se detectan: la de creación y la del estado en el que están ahora.
function missingDates(task) {
  const now = Date.now();
  const fields = {};
  if (task.createdAt === null) fields.createdAt = now;
  const currentField = STATUS_DATE_FIELDS[task.status];
  if (task[currentField] === null) fields[currentField] = now;
  return fields;
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
    if (remote) backfilledIds.add(task.id);
    Object.assign(task, fields);
    updateRemote(task.id, fields);
  });
  saveTasks();
}

// Fechas al entrar en un estado: se registra el momento actual y, si la tarea retrocede,
// se borran las de los estados posteriores porque dejan de ser ciertas. Al volver a Pendiente
// la fecha de creación pasa a ser la del cambio, pero se conserva la de En curso como
// constancia de que la tarea ya estuvo en curso (ver wasInProgress).
function datesForStatus(status) {
  const dates = { [STATUS_DATE_FIELDS[status]]: Date.now() };
  STATUSES.slice(STATUSES.indexOf(status) + 1).forEach((later) => {
    dates[STATUS_DATE_FIELDS[later]] = null;
  });
  if (status === 'pending') delete dates.startedAt;
  return dates;
}

// Una tarea pendiente con fecha de En curso es una que se devolvió desde En curso.
function wasInProgress(task) {
  return task.status === 'pending' && task.startedAt !== null;
}

// Ordena por "order"; el id desempata tareas creadas a la vez en dos dispositivos.
function sortTasks(list) {
  return list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// Orden dentro de una columna: por etiqueta y, dentro de cada etiqueta, por el orden manual.
// sort es estable, así que basta con comparar la etiqueta si la lista ya viene por "order".
function priorityRank(task) {
  return task.priority === null ? NO_PRIORITY_RANK : PRIORITY_RANK[task.priority];
}

function sortByPriority(list) {
  return list.sort((a, b) => priorityRank(a) - priorityRank(b));
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function nextOrder() {
  return tasks.length ? tasks[tasks.length - 1].order + 1 : 0;
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    showNotice('No se pudieron guardar los cambios en este navegador.');
  }
}

function countByStatus(status) {
  return tasks.filter((t) => t.status === status).length;
}

function isColumnFull(status) {
  const limit = WIP_LIMITS[status];
  return limit !== undefined && countByStatus(status) >= limit;
}

// Muestra un mensaje en el elemento indicado y lo oculta pasados MESSAGE_DURATION ms.
function flashMessage(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(messageTimeouts.get(element));
  messageTimeouts.set(element, setTimeout(() => element.classList.add('hidden'), MESSAGE_DURATION));
}

function showNotice(message) {
  flashMessage(boardNotice, message);
}

function announceNewTasks(newTasks) {
  const message = newTasks.length === 1
    ? `Se agregó una nueva tarea: "${newTasks[0].text}"`
    : `Se agregaron ${newTasks.length} tareas nuevas`;
  flashMessage(toast, message);
}

function announceEditedTasks(editedTasks) {
  const message = editedTasks.length === 1
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
  const task = {
    id: createId(), text, status: 'pending', order: nextOrder(), ...readDates({}), ...readLabels({}), createdAt: Date.now(),
  };
  tasks.push(task);
  saveTasks();
  saveRemote(task);
  render();
  announceNewTasks([task]);
}

// Mueve una tarea a otra columna; si se indica beforeId, la coloca antes de esa tarea.
function moveTask(id, status, beforeId = null) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  if (task.status !== status && isColumnFull(status)) {
    showNotice(`Límite WIP alcanzado: termina una tarea "En curso" antes de empezar otra (máx. ${WIP_LIMITS[status]}).`);
    return;
  }

  // Reordenar dentro de la misma columna no cambia el historial de fechas.
  const dates = task.status === status ? {} : datesForStatus(status);
  tasks = tasks.filter((t) => t.id !== id);
  task.status = status;
  Object.assign(task, dates);

  // El nuevo orden queda entre la tarea anterior y beforeId, así solo cambia esta tarea.
  const beforeIndex = beforeId === null ? -1 : tasks.findIndex((t) => t.id === beforeId);
  if (beforeIndex === -1) {
    task.order = nextOrder();
    tasks.push(task);
  } else {
    const next = tasks[beforeIndex].order;
    const prev = beforeIndex > 0 ? tasks[beforeIndex - 1].order : next - 1;
    task.order = (prev + next) / 2;
    tasks.splice(beforeIndex, 0, task);
  }

  saveTasks();
  updateRemote(task.id, { status: task.status, order: task.order, ...dates });
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
  const task = tasks.find((t) => t.id === id);
  if (!task || task.priority === priority) return;
  updateTask(id, { priority, order: nextOrder() });
  sortTasks(tasks);
  highlight([id]);
  render();
}

function setDueDate(id, dueDate) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.dueDate === dueDate) return;
  updateTask(id, { dueDate });
  render();
}

function parseDueDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Días hábiles (lunes a viernes) desde mañana hasta la fecha, ambos incluidos. Se deja de
// contar al pasar el límite porque solo importa saber si se supera.
function businessDaysUntil(date) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  let count = 0;
  while (day < date && count <= DUE_SOON_BUSINESS_DAYS) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0 && day.getDay() !== 6) count += 1;
  }
  return count;
}

// Estado del vencimiento ({ kind, text, title }) o null si no tiene fecha o ya se completó.
// kind: "overdue" (vencida), "soon" (próxima a vencer) o "scheduled" (aún con margen).
function dueInfo(task) {
  if (task.dueDate === null || task.status === 'completed') return null;
  const due = parseDueDate(task.dueDate);
  const title = `Fecha límite: ${longDateFormat.format(due)}`;
  const days = -calendarDaysSince(due.getTime());

  if (days < 0) return { kind: 'overdue', text: `⛔ Venció hace ${plural(-days, 'día', 'días')}`, title };
  if (days === 0) return { kind: 'soon', text: '⏳ Vence hoy', title };
  if (businessDaysUntil(due) <= DUE_SOON_BUSINESS_DAYS) {
    return { kind: 'soon', text: days === 1 ? '⏳ Vence mañana' : `⏳ Vence en ${days} días`, title };
  }
  return { kind: 'scheduled', text: `📅 Vence el ${shortDateFormat.format(due)}`, title };
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

// Días calendario entre la fecha y hoy (de medianoche a medianoche, en la hora local).
function calendarDaysSince(ms) {
  const start = new Date(ms);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Se redondea porque los cambios de horario hacen que un día dure 23 o 25 horas.
  return Math.round((today - start) / 86400000);
}

// Días que la tarea lleva detenida en su columna, o null si no supera el límite.
function overdueDays(task) {
  if (!OVERDUE_COLUMNS[task.status]) return null;
  const since = task[STATUS_DATE_FIELDS[task.status]];
  if (since === null) return null;
  const days = calendarDaysSince(since);
  return days > OVERDUE_DAYS ? days : null;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Firma de las alertas actuales; si cambia (pasa un día, una tarea supera el límite)
// hay que volver a dibujar el tablero.
function overdueSignature() {
  return tasks.map((t) => `${t.id}:${overdueDays(t)}:${dueInfo(t)?.text}`).join('|');
}
let lastOverdueSignature = '';

// Turno de recordatorio vigente ({ id: "2026-10-5@10", label }), o null en fin de semana
// o antes de las 10:00. Si la página se abre más tarde, el turno sigue pendiente.
function currentReminderSlot(now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day === 6) return null;
  const slot = [...REMINDER_SLOTS].reverse().find((s) => now.getHours() >= s.hour);
  if (!slot) return null;
  return { id: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}@${slot.hour}`, label: slot.label };
}

// Copia en memoria por si el navegador no permite usar localStorage.
let lastReminderShown = null;

function readLastReminder() {
  try {
    return localStorage.getItem(REMINDER_KEY) ?? lastReminderShown;
  } catch {
    return lastReminderShown;
  }
}

function markReminderShown(id) {
  lastReminderShown = id;
  try {
    localStorage.setItem(REMINDER_KEY, id);
  } catch {
    // Sin almacenamiento basta con la copia en memoria mientras la página siga abierta.
  }
}

// Muestra el recordatorio si toca turno, no se ha mostrado aún y hay tareas detenidas.
// Espera a que la pestaña esté visible para que el minuto en pantalla no pase sin verse.
function checkReminder() {
  if (document.visibilityState !== 'visible') return;
  const slot = currentReminderSlot();
  if (!slot || readLastReminder() === slot.id) return;
  if (attentionGroups().length === 0) return;

  markReminderShown(slot.id);
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

// Grupos de tareas que el recordatorio menciona: detenidas por columna, urgentes, vencidas y
// próximas a vencer. Solo se devuelven los que tienen alguna tarea.
function attentionGroups() {
  const open = tasks.filter((t) => t.status !== 'completed');
  const idsOf = (list) => list.map((t) => t.id);
  const groups = Object.entries(OVERDUE_COLUMNS).map(([status, { name, phrase }]) => {
    const ids = idsOf(tasks.filter((t) => t.status === status && overdueDays(t) !== null));
    return { ids, text: `${plural(ids.length, 'tarea lleva', 'tareas llevan')} más de ${OVERDUE_DAYS} días ${phrase}.`, label: `Ver tareas detenidas en ${name}` };
  });
  const urgent = idsOf(open.filter((t) => t.priority === 'urgent'));
  const overdueDue = idsOf(open.filter((t) => dueInfo(t)?.kind === 'overdue'));
  const soonDue = idsOf(open.filter((t) => dueInfo(t)?.kind === 'soon'));
  groups.push(
    { ids: urgent, text: `${plural(urgent.length, 'tarea urgente', 'tareas urgentes')} sin completar.`, label: 'Ver tareas urgentes' },
    { ids: overdueDue, text: `${plural(overdueDue.length, 'tarea vencida', 'tareas vencidas')}.`, label: 'Ver tareas vencidas' },
    { ids: soonDue, text: `${plural(soonDue.length, 'tarea vence', 'tareas vencen')} en ${DUE_SOON_BUSINESS_DAYS} días hábiles o menos.`, label: 'Ver tareas próximas a vencer' },
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
    const overdue = columnTasks.filter((t) => overdueDays(t) !== null).length;
    const urgent = columnTasks.filter((t) => t.priority === 'urgent').length;
    const due = columnTasks.filter(FILTERS.due).length;
    setColumnChip(`[data-alert="${status}"]`, `⏰ ${overdue}`, `${plural(overdue, 'tarea lleva', 'tareas llevan')} más de ${OVERDUE_DAYS} días ${phrase}`, overdue);
    setColumnChip(`[data-urgent="${status}"]`, `🔴 ${urgent}`, plural(urgent, 'tarea urgente', 'tareas urgentes'), urgent);
    setColumnChip(`[data-due="${status}"]`, `⏳ ${due}`, `${plural(due, 'tarea vencida o', 'tareas vencidas o')} próximas a vencer`, due);
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
  const nextStatus = STATUSES[STATUSES.indexOf(task.status) + direction];
  if (nextStatus) moveTask(id, nextStatus);
}

function deleteTask(id) {
  if (editing && editing.id === id) editing = null;
  if (labelMenuId === id) labelMenuId = null;
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  deleteRemote([id]);
  render();
}

function clearCompleted() {
  const completedIds = tasks.filter((t) => t.status === 'completed').map((t) => t.id);
  if (editing && completedIds.includes(editing.id)) editing = null;
  tasks = tasks.filter((t) => t.status !== 'completed');
  saveTasks();
  deleteRemote(completedIds);
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
  console.error('Error de sincronización con Firestore:', error);

  // La conexión funciona pero las reglas de seguridad rechazaron el cambio; Firestore lo
  // deshace solo y el tablero vuelve a mostrar lo que hay en el servidor.
  if (error.code === 'permission-denied' && remote) {
    showNotice('El servidor rechazó el cambio (reglas de seguridad de Firestore). Revisa la consola para más detalle.');
    return;
  }

  if (syncStatus.dataset.state !== 'offline') {
    showNotice('No se pudo conectar con el servidor: los cambios solo se guardan en este dispositivo.');
  }
  setSyncStatus('offline');
}

// Campos de la tarea que se guardan en Firestore (todo menos el id, que es el del documento).
// Las etiquetas vacías no se envían: una tarea nueva no las necesita.
function remoteData({ id, ...data }) {
  ['priority', 'dueDate'].forEach((field) => {
    if (data[field] === null) delete data[field];
  });
  return data;
}

function saveRemote(task) {
  if (!remote) return;
  const { db, fs } = remote;
  fs.setDoc(fs.doc(db, TASKS_COLLECTION, task.id), remoteData(task)).catch(handleSyncError);
}

function updateRemote(id, fields) {
  if (!remote) return;
  const { db, fs } = remote;
  fs.updateDoc(fs.doc(db, TASKS_COLLECTION, id), fields).catch((error) => {
    // Otro dispositivo borró la tarea mientras se cambiaba aquí; el snapshot ya la quitará.
    if (error.code === 'not-found') return;
    handleSyncError(error);
  });
}

function deleteRemote(ids) {
  if (!remote || ids.length === 0) return;
  const { db, fs } = remote;
  const batch = fs.writeBatch(db);
  ids.forEach((id) => batch.delete(fs.doc(db, TASKS_COLLECTION, id)));
  batch.commit().catch(handleSyncError);
}

// Sube una sola vez las tareas que este navegador tenía guardadas antes de usar Firestore.
function migrateLocalTasks() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return;
  }
  if (tasks.length === 0) return;

  const { db, fs } = remote;
  const batch = fs.writeBatch(db);
  tasks.forEach((task) => batch.set(fs.doc(db, TASKS_COLLECTION, task.id), remoteData(task)));
  batch
    .commit()
    .then(() => {
      try {
        localStorage.setItem(MIGRATED_KEY, '1');
      } catch {
        // Sin almacenamiento local no hay forma de recordar la migración; no pasa nada si se repite.
      }
    })
    .catch(handleSyncError);
}

// Conecta con Firestore y escucha los cambios de cualquier dispositivo. Si Firebase no
// carga (sin internet, bloqueado), el tablero sigue funcionando solo con localStorage.
async function connectRemote() {
  setSyncStatus('connecting');
  try {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${FIREBASE_CDN}/firebase-app.js`),
      import(`${FIREBASE_CDN}/firebase-auth.js`),
      import(`${FIREBASE_CDN}/firebase-firestore.js`),
    ]);
    const app = initializeApp(APP_ENV.firebaseConfig);
    await auth.signInAnonymously(auth.getAuth(app));
    remote = { db: fs.getFirestore(app), fs };
  } catch (error) {
    handleSyncError(error);
    return;
  }

  migrateLocalTasks();

  let firstSnapshot = true;
  const { db, fs } = remote;
  fs.onSnapshot(
    fs.collection(db, TASKS_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      // Las tareas creadas en este navegador ya se anunciaron en addTask (llevan escrituras pendientes).
      const incoming = snapshot
        .docChanges()
        .filter((change) => change.type === 'added' && !change.doc.metadata.hasPendingWrites)
        .map((change) => taskFromDoc(change.doc));

      const previousTasks = tasks;
      tasks = sortTasks(snapshot.docs.map(taskFromDoc));
      backfillDates();
      saveTasks();
      // Los cambios propios ya están aplicados en previousTasks, así que solo se detectan los ajenos.
      if (!firstSnapshot) notifyRemoteChanges(previousTasks);
      render();
      setSyncStatus(snapshot.metadata.fromCache ? 'offline' : 'online');

      if (!firstSnapshot && incoming.length > 0) announceNewTasks(incoming);
      firstSnapshot = false;
    },
    handleSyncError,
  );
}

function taskFromDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    text: String(data.text ?? ''),
    status: STATUSES.includes(data.status) ? data.status : 'pending',
    order: typeof data.order === 'number' ? data.order : 0,
    ...readDates(data),
    ...readLabels(data),
  };
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

  const days = overdueDays(task);
  if (days !== null) {
    li.classList.add('overdue');
    const badge = document.createElement('p');
    badge.className = 'overdue-badge';
    badge.textContent = `⏰ Lleva ${days} días ${OVERDUE_COLUMNS[task.status].phrase}`;
    badge.title = `Supera el límite de ${OVERDUE_DAYS} días calendario`;
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

const dateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFormatWithYear = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    if (status === task.status && overdueDays(task) !== null) item.classList.add('is-overdue');

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
  const cards = [...list.querySelectorAll('.card:not(.dragging)')]
    .filter((card) => card.dataset.priority === (priority ?? ''));
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
  const focused = editing && editing.element && editing.element.contains(document.activeElement)
    ? document.activeElement
    : null;
  const selection = focused === editing?.textarea
    ? [focused.selectionStart, focused.selectionEnd]
    : null;

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
    list.closest('.column').classList.toggle('full', isColumnFull(status));
  });

  const openCount = tasks.filter((t) => t.status !== 'completed').length;
  taskCount.textContent = `${openCount} tarea${openCount === 1 ? '' : 's'} sin completar`;

  clearCompletedBtn.disabled = countByStatus('completed') === 0;
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
  if (remote || (event.key !== null && event.key !== STORAGE_KEY)) return;
  const previousTasks = tasks;
  const knownIds = new Set(tasks.map((t) => t.id));
  tasks = loadTasks();
  notifyRemoteChanges(previousTasks);
  render();
  const newTasks = tasks.filter((t) => !knownIds.has(t.id));
  if (newTasks.length > 0) announceNewTasks(newTasks);
});

backfillDates();
render();
connectRemote();
