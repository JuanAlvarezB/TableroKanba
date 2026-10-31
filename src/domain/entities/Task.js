// Tarea del tablero: su forma, sus estados y cómo se lee desde datos guardados (localStorage o
// Firestore). Sin dependencias del navegador ni de Firebase.

/**
 * @typedef {'pending' | 'in-progress' | 'completed'} Status
 * @typedef {'urgent' | 'high' | 'low'} Priority
 *
 * @typedef {object} Task
 * @property {string} id
 * @property {string} text
 * @property {Status} status
 * @property {number} order Orden manual dentro del tablero (puede ser fraccionario).
 * @property {number | null} createdAt Cuándo entró en Pendiente (ms desde 1970).
 * @property {number | null} startedAt Cuándo entró en En curso.
 * @property {number | null} completedAt Cuándo se completó.
 * @property {Priority | null} priority Etiqueta opcional.
 * @property {string | null} dueDate Fecha límite opcional ("2026-10-15", día local).
 * @property {HistoryEvent[] | null} history Cambios de la tarea; null si aún no tiene historial
 *   guardado (tareas anteriores a él: se deriva de las fechas, ver domain/rules/history.js).
 * @property {Subtask[]} subtasks Pasos de la tarea, en su orden; [] si no tiene (docs/PLAN_SUBTAREAS.md).
 * @property {number} openSubtasks Cuántas subtareas siguen pendientes. Se calcula siempre desde la lista al
 *   leer; el valor guardado no se usa.
 *
 * Subtarea: solo texto y estado (docs/PLAN_SUBTAREAS.md, 2.2).
 * @typedef {object} Subtask
 * @property {string} id Aleatorio, 8 caracteres.
 * @property {string} text Hasta 200 caracteres, nunca vacío.
 * @property {boolean} done Terminada.
 *
 * Evento del historial (docs/PLAN_USUARIOS.md, 4.2). No lleva datos de la persona: su dueño es el
 * ownerId de la tarea.
 * @typedef {object} HistoryEvent
 * @property {string} id Aleatorio (arrayUnion descarta elementos idénticos); determinista en los derivados.
 * @property {'create' | 'edit' | 'move' | 'priority' | 'due' | 'subtask'} type Una versión anterior puede
 *   encontrar tipos que no conoce: los conserva sin mostrarlos (readEvent).
 * @property {number} at Hora del dispositivo (ms desde 1970).
 * @property {string} [text] create: texto inicial, recortado; subtask: texto de la subtarea.
 * @property {string | null} [from] edit, move, priority y due: valor anterior.
 * @property {string | null} [to] Valor nuevo; en subtask, 'done' (terminada) o 'pending' (pendiente otra vez).
 * @property {true} [derived] Calculado a partir de las fechas guardadas.
 */

// Columnas del tablero, en el orden del flujo de trabajo.
/** @type {Status[]} */
export const STATUSES = ['pending', 'in-progress', 'completed'];

// Historial de fechas: cada estado guarda cuándo entró la tarea en él (milisegundos
// desde 1970, o null si aún no ha pasado por ese estado).
export const STATUS_DATE_FIELDS = { pending: 'createdAt', 'in-progress': 'startedAt', completed: 'completedAt' };

// Etiquetas de prioridad, en el orden de la columna; las tareas sin etiqueta van al final.
/** @type {Priority[]} */
export const PRIORITY_LEVELS = ['urgent', 'high', 'low'];

export const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Lee las fechas guardadas; las que falten quedan en null (missingDates las completa).
export function readDates(source) {
  const dates = {};
  Object.values(STATUS_DATE_FIELDS).forEach((field) => {
    dates[field] = Number.isFinite(source[field]) ? source[field] : null;
  });
  return dates;
}

// Lee la prioridad y la fecha límite; si no hay o no son válidas quedan en null (sin etiqueta).
export function readLabels(source) {
  return {
    priority: PRIORITY_LEVELS.includes(source.priority) ? source.priority : null,
    dueDate: typeof source.dueDate === 'string' && DUE_DATE_PATTERN.test(source.dueDate) ? source.dueDate : null,
  };
}

// Tope de eventos del historial de una tarea; las reglas de Firestore también lo exigen.
export const HISTORY_LIMIT = 100;

// Topes de las subtareas (docs/PLAN_SUBTAREAS.md, 2.2). Las reglas exigen también las 20.
export const SUBTASK_LIMIT = 20;
export const SUBTASK_TEXT_LIMIT = 200;

const isText = (value) => typeof value === 'string';
const isStatus = (value) => STATUSES.includes(value);
const isPriorityOrNone = (value) => value === null || PRIORITY_LEVELS.includes(value);
const isDueDateOrNone = (value) => value === null || (isText(value) && DUE_DATE_PATTERN.test(value));

// Campos propios de cada tipo de evento y cómo se validan. El from de un move es null en el
// primer evento derivado (antes de él no se sabe nada de la tarea).
const EVENT_FIELDS = {
  create: { text: isText },
  edit: { from: isText, to: isText },
  move: { from: (value) => value === null || isStatus(value), to: isStatus },
  priority: { from: isPriorityOrNone, to: isPriorityOrNone },
  due: { from: isDueDateOrNone, to: isDueDateOrNone },
  subtask: { text: isText, to: (value) => value === 'done' || value === 'pending' },
};

// Si el evento es de un tipo que esta versión sabe mostrar.
export function isKnownEvent(event) {
  return Object.hasOwn(EVENT_FIELDS, event.type);
}

// Campo simple de un evento de tipo desconocido que se conserva tal cual: texto corto, número, booleano o null.
const isSimpleValue = (value) =>
  value === null ||
  typeof value === 'boolean' ||
  Number.isFinite(value) ||
  (isText(value) && Array.from(value).length <= SUBTASK_TEXT_LIMIT);

// Copia del evento con solo sus campos conocidos, o null si está mal formado. Un tipo que esta versión no
// conoce (de una versión posterior) se conserva con sus campos simples, para que una compactación no lo
// borre (docs/PLAN_SUBTAREAS.md, P-12); la vista no lo muestra (isKnownEvent).
function readEvent(raw) {
  if (!raw || !isText(raw.type) || raw.type === '') return null;
  if (!isText(raw.id) || raw.id === '' || !Number.isFinite(raw.at)) return null;
  const event = { id: raw.id, type: raw.type, at: raw.at };
  if (!isKnownEvent(raw)) {
    for (const [field, value] of Object.entries(raw)) {
      if (field !== '__proto__' && !(field in event) && isSimpleValue(value)) event[field] = value;
    }
    return event;
  }
  for (const [field, isValid] of Object.entries(EVENT_FIELDS[raw.type])) {
    if (!isValid(raw[field])) return null;
    event[field] = raw[field];
  }
  if (raw.derived === true) event.derived = true;
  return event;
}

// Lee el historial guardado: descarta los eventos mal formados (las reglas no pueden revisarlos uno
// a uno) y se queda como mucho con los 100 más recientes. Sin lista, null: la tarea es anterior al
// historial y se deriva de sus fechas.
export function readHistory(source) {
  if (!Array.isArray(source.history)) return null;
  return source.history.map(readEvent).filter(Boolean).slice(-HISTORY_LIMIT);
}

// Cuántas subtareas siguen pendientes.
export function countOpenSubtasks(subtasks) {
  return subtasks.filter((subtask) => !subtask.done).length;
}

/**
 * Lee las subtareas guardadas sin confiar en ellas (las reglas no pueden revisarlas una a una): descarta
 * las mal formadas o repetidas, recorta los textos a 200 caracteres y se queda con las 20 primeras. El
 * contador se calcula siempre desde la lista leída. Sin lista: sin subtareas.
 * @returns {{ subtasks: Subtask[], openSubtasks: number }}
 */
export function readSubtasks(source) {
  const subtasks = [];
  const seen = new Set();
  for (const raw of Array.isArray(source.subtasks) ? source.subtasks : []) {
    if (subtasks.length === SUBTASK_LIMIT) break;
    if (!raw || !isText(raw.id) || raw.id === '' || seen.has(raw.id)) continue;
    if (!isText(raw.text) || raw.text.trim() === '' || typeof raw.done !== 'boolean') continue;
    seen.add(raw.id);
    subtasks.push({ id: raw.id, text: Array.from(raw.text).slice(0, SUBTASK_TEXT_LIMIT).join(''), done: raw.done });
  }
  return { subtasks, openSubtasks: countOpenSubtasks(subtasks) };
}

// Lo mínimo para considerar tarea un elemento guardado en localStorage.
export function isStoredTask(raw) {
  return Boolean(raw) && typeof raw.text === 'string';
}

/**
 * Tarea guardada en localStorage (ya validada con isStoredTask), con migración de formatos
 * anteriores ({ completed: boolean }, id numérico, sin orden: se usa su posición).
 * @returns {Task}
 */
export function taskFromStorage(raw, index) {
  return {
    id: String(raw.id),
    text: raw.text,
    status: STATUSES.includes(raw.status) ? raw.status : raw.completed ? 'completed' : 'pending',
    order: typeof raw.order === 'number' ? raw.order : index,
    ...readDates(raw),
    ...readLabels(raw),
    history: readHistory(raw),
    ...readSubtasks(raw),
  };
}

/**
 * Tarea a partir de los campos de un documento de Firestore.
 * @returns {Task}
 */
export function taskFromData(id, data) {
  return {
    id,
    text: String(data.text ?? ''),
    status: STATUSES.includes(data.status) ? data.status : 'pending',
    order: typeof data.order === 'number' ? data.order : 0,
    ...readDates(data),
    ...readLabels(data),
    history: readHistory(data),
    ...readSubtasks(data),
  };
}

/**
 * Tarea nueva: entra en Pendiente, sin etiquetas ni subtareas. Su historial empieza con el evento de creación,
 * que se recibe hecho (domain/rules/history.js lo genera con historyEventsFor).
 * @param {{ id: string, text: string, order: number, now?: number, history?: HistoryEvent[] }} input
 * @returns {Task}
 */
export function createTask({ id, text, order, now = Date.now(), history = [] }) {
  return {
    id,
    text,
    status: 'pending',
    order,
    ...readDates({}),
    ...readLabels({}),
    createdAt: now,
    history,
    subtasks: [],
    openSubtasks: 0,
  };
}

// Fechas al entrar en un estado: se registra el momento actual y, si la tarea retrocede,
// se borran las de los estados posteriores porque dejan de ser ciertas. Al volver a Pendiente
// la fecha de creación pasa a ser la del cambio, pero se conserva la de En curso como
// constancia de que la tarea ya estuvo en curso (ver wasInProgress).
export function datesForStatus(status, now = Date.now()) {
  const dates = { [STATUS_DATE_FIELDS[status]]: now };
  STATUSES.slice(STATUSES.indexOf(status) + 1).forEach((later) => {
    dates[STATUS_DATE_FIELDS[later]] = null;
  });
  if (status === 'pending') delete dates.startedAt;
  return dates;
}

// Una tarea pendiente con fecha de En curso es una que se devolvió desde En curso.
export function wasInProgress(task) {
  return task.status === 'pending' && task.startedAt !== null;
}

// Las tareas creadas antes de existir el historial reciben como fecha por defecto el momento
// en que se detectan: la de creación y la del estado en el que están ahora.
export function missingDates(task, now = Date.now()) {
  const fields = {};
  if (task.createdAt === null) fields.createdAt = now;
  const currentField = STATUS_DATE_FIELDS[task.status];
  if (task[currentField] === null) fields[currentField] = now;
  return fields;
}
