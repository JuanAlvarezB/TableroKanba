// Reglas de las subtareas (docs/PLAN_SUBTAREAS.md, 2.4): progreso, si una tarea se puede completar y la
// única forma de escribir la lista, siempre junto con su contador de pendientes. Las reglas de Firestore
// exigen las mismas 20 subtareas y que una tarea completada no tenga pendientes.
import { SUBTASK_LIMIT, SUBTASK_TEXT_LIMIT, countOpenSubtasks, readSubtasks } from '../entities/Task.js';

export { SUBTASK_LIMIT, SUBTASK_TEXT_LIMIT, countOpenSubtasks };

/**
 * @typedef {import('../entities/Task.js').Task} Task
 * @typedef {import('../entities/Task.js').Subtask} Subtask
 */

// Subtareas de una tarea; las tareas leídas antes de existir el campo no lo tienen.
export function subtasksOf(task) {
  return Array.isArray(task.subtasks) ? task.subtasks : [];
}

/** Progreso para "2 de 4 subtareas". */
export function subtaskProgress(task) {
  const subtasks = subtasksOf(task);
  return { done: subtasks.length - countOpenSubtasks(subtasks), total: subtasks.length };
}

/**
 * Por qué no se puede completar la tarea todavía, o null si se puede (sin subtareas o todas terminadas).
 * @returns {{ reason: 'open-subtasks', open: number, total: number, pending: string[] } | null}
 */
export function completionBlock(task) {
  const subtasks = subtasksOf(task);
  const pending = subtasks.filter((subtask) => !subtask.done).map((subtask) => subtask.text);
  if (pending.length === 0) return null;
  return { reason: 'open-subtasks', open: pending.length, total: subtasks.length, pending };
}

/**
 * Lo que se escribe al cambiar las subtareas: la lista entera y su contador, en la misma operación. Es la
 * única forma de construir esa escritura, así lista y contador nunca se separan.
 * @param {Subtask[]} subtasks
 * @returns {{ subtasks: Subtask[], openSubtasks: number }}
 */
export function subtaskChanges(subtasks) {
  return { subtasks, openSubtasks: countOpenSubtasks(subtasks) };
}

/**
 * Si el contador guardado en el documento no coincide con su lista (dato manipulado o error de un cliente):
 * la tarea se lee con el contador recalculado y se repara al escribir los dos (docs/PLAN_SUBTAREAS.md, P-13).
 * Sin ninguno de los dos campos no hay nada que reparar.
 * @param {object} data Campos del documento guardado.
 */
export function counterDrifts(data) {
  if (!('subtasks' in data) && !('openSubtasks' in data)) return false;
  return data.openSubtasks !== readSubtasks(data).openSubtasks;
}

// Texto de una subtarea tal como se guarda: una sola línea, sin espacios en los extremos.
export function normalizeSubtaskText(text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Motivo por el que el texto no sirve, o null si sirve. */
export function subtaskTextProblem(text) {
  if (text === '') return 'empty';
  if (Array.from(text).length > SUBTASK_TEXT_LIMIT) return 'too-long';
  return null;
}
