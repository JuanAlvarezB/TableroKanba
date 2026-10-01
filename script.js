const STORAGE_KEY = 'tareas';
// Marca que las tareas guardadas solo en este navegador ya se subieron a Firestore.
const MIGRATED_KEY = 'tareas-migradas';

// Proyecto de Firebase donde se guardan y sincronizan las tareas entre dispositivos.
// Esta configuración es pública por diseño; los datos los protegen las reglas de Firestore.
const firebaseConfig = {
  apiKey: 'AIzaSyDU9ccKPhiLgn1T6QRf-qfpujcNPnVwEfQ',
  authDomain: 'tablero-kanban-76c61.firebaseapp.com',
  projectId: 'tablero-kanban-76c61',
  storageBucket: 'tablero-kanban-76c61.firebasestorage.app',
  messagingSenderId: '141842598240',
  appId: '1:141842598240:web:9c9ab78a96e8fe55e6b605',
};
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

let tasks = loadTasks();
let draggedId = null;

// Tarea en edición: { id, original, element, textarea, note }; null si no se edita ninguna.
// El editor se reutiliza entre renders para no perder lo escrito cuando llegan cambios remotos.
let editing = null;

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
// se borran las de los estados posteriores porque dejan de ser ciertas.
function datesForStatus(status) {
  const dates = { [STATUS_DATE_FIELDS[status]]: Date.now() };
  STATUSES.slice(STATUSES.indexOf(status) + 1).forEach((later) => {
    dates[STATUS_DATE_FIELDS[later]] = null;
  });
  return dates;
}

// Ordena por "order"; el id desempata tareas creadas a la vez en dos dispositivos.
function sortTasks(list) {
  return list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
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
    return before && (before.text !== t.text || before.status !== t.status);
  });
  highlight(changed.map((t) => t.id));
  const edited = changed.filter((t) => previous.get(t.id).text !== t.text);
  if (edited.length > 0) announceEditedTasks(edited);
}

function addTask(text) {
  const task = { id: createId(), text, status: 'pending', order: nextOrder(), ...readDates({}), createdAt: Date.now() };
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
  return tasks.map((t) => `${t.id}:${overdueDays(t)}`).join('|');
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
  if (!tasks.some((t) => overdueDays(t) !== null)) return;

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

// Lleva a las tareas detenidas de una columna y las resalta.
function showOverdue(status) {
  const ids = tasks.filter((t) => t.status === status && overdueDays(t) !== null).map((t) => t.id);
  if (ids.length === 0) return;
  highlight(ids);
  render();
  const card = document.querySelector(`.card[data-id="${CSS.escape(ids[0])}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderOverdueAlerts() {
  const overdue = tasks.filter((t) => overdueDays(t) !== null);
  lastOverdueSignature = overdueSignature();

  overdueSummary.innerHTML = '';
  Object.entries(OVERDUE_COLUMNS).forEach(([status, { name, phrase }]) => {
    const count = overdue.filter((t) => t.status === status).length;

    const chip = document.querySelector(`[data-alert="${status}"]`);
    chip.textContent = `⏰ ${count}`;
    chip.title = `${plural(count, 'tarea lleva', 'tareas llevan')} más de ${OVERDUE_DAYS} días ${phrase}`;
    chip.classList.toggle('hidden', count === 0);

    if (count === 0) return;
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${plural(count, 'tarea lleva', 'tareas llevan')} más de ${OVERDUE_DAYS} días ${phrase}.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overdue-show';
    button.textContent = 'Ver';
    button.setAttribute('aria-label', `Ver tareas detenidas en ${name}`);
    button.addEventListener('click', () => showOverdue(status));
    item.append(text, button);
    overdueSummary.append(item);
  });

  // Si mientras se muestra se resuelven todas las tareas detenidas, el aviso sobra.
  if (overdue.length === 0) hideReminder();
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
function remoteData({ id, ...data }) {
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
    const app = initializeApp(firebaseConfig);
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
  };
}

function createCard(task) {
  if (editing && editing.id === task.id) return getEditorCard(task);

  const li = document.createElement('li');
  li.className = `card ${task.status}`;
  li.draggable = true;
  li.dataset.id = task.id;

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

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Eliminar tarea';
  deleteBtn.setAttribute('aria-label', 'Eliminar tarea');
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  actions.append(backBtn, forwardBtn);
  if (isEditable(task)) actions.append(editBtn);
  actions.append(deleteBtn);
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
  return li;
}

const dateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFormatWithYear = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fullDateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });

// El año solo se muestra si no es el actual, para que la fecha ocupe poco en la tarjeta.
function formatDate(ms) {
  const date = new Date(ms);
  const format = date.getFullYear() === new Date().getFullYear() ? dateFormat : dateFormatWithYear;
  return format.format(date);
}

// Línea de tiempo con las fechas en que la tarea entró en cada estado.
function createHistory(task) {
  const list = document.createElement('ol');
  list.className = 'task-history';
  list.setAttribute('aria-label', 'Historial de estados');

  STATUSES.forEach((status) => {
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
  return list;
}

// Devuelve la tarjeta en modo edición: se crea la primera vez y después se reutiliza,
// solo actualizando columna y texto si otro dispositivo los cambió.
function getEditorCard(task) {
  if (!editing.element) editing.element = createEditor(task);
  const { element, textarea, note } = editing;
  element.className = `card editing ${task.status}`;

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

// Devuelve la tarjeta situada justo debajo del cursor, para insertar antes de ella.
function getCardAfterCursor(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')];
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
    if (columnTasks.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Sin tareas';
      list.appendChild(empty);
    } else {
      columnTasks.forEach((task) => list.appendChild(createCard(task)));
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

    const afterCard = getCardAfterCursor(list, event.clientY);
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
