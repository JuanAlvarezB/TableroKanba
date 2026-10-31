// Historial de cambios de una tarea (docs/PLAN_USUARIOS.md, sección 4): qué eventos genera cada
// cambio, el historial que se deriva de las fechas en las tareas anteriores a esta función y cómo se
// escribe sin pasar del tope. Es adicional: las alertas, los recordatorios y la limpieza siguen
// usando createdAt, startedAt y completedAt. Ningún evento lleva datos de la persona.
import { HISTORY_LIMIT, STATUSES, STATUS_DATE_FIELDS, isKnownEvent } from '../entities/Task.js';

export { HISTORY_LIMIT };

// Desde 90 eventos, la siguiente escritura compacta el historial a los 60 más recientes más los
// nuevos. Los 10 de margen hasta el tope absorben los eventos que otros dispositivos añadan sin
// conexión a la vez (A-39, A-40).
export const HISTORY_SOFT_LIMIT = 90;
export const HISTORY_KEEP = 60;

// Largo máximo de los textos de create y edit, con … al final (A-45).
export const HISTORY_TEXT_LIMIT = 200;

/**
 * @typedef {import('../entities/Task.js').Task} Task
 * @typedef {import('../entities/Task.js').HistoryEvent} HistoryEvent
 * @typedef {{ mode: 'append', events: HistoryEvent[] } | { mode: 'replace', history: HistoryEvent[] }} HistoryWrite
 */

// Cuenta caracteres, no unidades UTF-16, para no partir un emoji por la mitad.
export function truncateText(text) {
  const chars = Array.from(text);
  if (chars.length <= HISTORY_TEXT_LIMIT) return text;
  return chars.slice(0, HISTORY_TEXT_LIMIT - 1).join('') + '…';
}

// Campos que generan evento y su tipo. order no está: reordenar dentro de la columna no es un cambio.
const TRACKED_FIELDS = { text: 'edit', status: 'move', priority: 'priority', dueDate: 'due' };

/**
 * Eventos de un cambio: uno por cada campo que cambia de valor. Sin tarea anterior es la creación.
 * Un cambio sin diferencias, o que solo cambia order, no genera eventos.
 * @param {Task | null} before La tarea antes del cambio (null al crearla).
 * @param {Partial<Task>} changes Los campos que cambian (al crear, al menos text).
 * @param {{ now: number, newId: () => string }} clock
 * @returns {HistoryEvent[]}
 */
export function historyEventsFor(before, changes, { now, newId }) {
  if (before === null) return [{ id: newId(), type: 'create', at: now, text: truncateText(changes.text) }];
  return Object.entries(TRACKED_FIELDS)
    .filter(([field]) => field in changes && changes[field] !== before[field])
    .map(([field, type]) => {
      const clip = field === 'text' ? truncateText : (value) => value;
      return { id: newId(), type, at: now, from: clip(before[field]), to: clip(changes[field]) };
    });
}

/**
 * Historial de una tarea sin el campo history, a partir de sus fechas y sin escribir nada: un move
 * por cada fecha guardada, encadenados. El estado actual va al final y los anteriores por fecha (una
 * tarea devuelta a Pendiente empieza por En curso). Nunca hay create: con las fechas no se sabe
 * cuándo se creó (A-44). Los identificadores son deterministas, así dos dispositivos que materialicen
 * a la vez no los duplican con arrayUnion.
 * @param {Task} task
 * @returns {HistoryEvent[]}
 */
export function deriveHistory(task) {
  const dated = (status) => ({ status, at: task[STATUS_DATE_FIELDS[status]] });
  // Completada solo puede ser un estado anterior si la tarea sigue completada: al retroceder se borra.
  const earlier = STATUSES.filter((status) => status !== task.status && status !== 'completed')
    .map(dated)
    .filter((step) => step.at !== null)
    .sort((a, b) => a.at - b.at);
  const steps = [...earlier, dated(task.status)].filter((step) => step.at !== null);
  return steps.map((step, index) => ({
    id: `d:${step.status}:${step.at}`,
    type: 'move',
    at: step.at,
    from: index === 0 ? null : steps[index - 1].status,
    to: step.status,
    derived: true,
  }));
}

// Lo que muestra la vista: el historial guardado o, si la tarea aún no tiene, el derivado. Los eventos de
// tipos que esta versión no conoce se guardan (para no perderlos al compactar) pero no se muestran.
export function effectiveHistory(task) {
  return Array.isArray(task.history) ? task.history.filter(isKnownEvent) : deriveHistory(task);
}

/**
 * Cómo se escriben los eventos nuevos, en la misma operación que el cambio:
 * - append: se añaden con arrayUnion. Si la tarea aún no tiene history, van antes los derivados de
 *   sus fechas (materialización perezosa, 4.5).
 * - replace: con 90 eventos o más, la lista pasa a ser los 60 más recientes más los nuevos.
 * @param {Task} task La tarea antes del cambio.
 * @param {HistoryEvent[]} events
 * @returns {HistoryWrite | null} null si no hay eventos.
 */
export function planHistoryWrite(task, events) {
  if (events.length === 0) return null;
  if (!Array.isArray(task.history)) return { mode: 'append', events: [...deriveHistory(task), ...events] };
  if (task.history.length >= HISTORY_SOFT_LIMIT) {
    return { mode: 'replace', history: [...task.history.slice(-HISTORY_KEEP), ...events] };
  }
  return { mode: 'append', events };
}
