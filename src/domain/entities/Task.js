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
  };
}

/**
 * Tarea nueva: entra en Pendiente, sin etiquetas.
 * @returns {Task}
 */
export function createTask({ id, text, order, now = Date.now() }) {
  return {
    id,
    text,
    status: 'pending',
    order,
    ...readDates({}),
    ...readLabels({}),
    createdAt: now,
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
