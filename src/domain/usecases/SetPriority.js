// Poner, cambiar o quitar la etiqueta de prioridad.
import { nextOrder } from '../rules/board.js';

/**
 * Campos que cambian, o null si la tarea no existe o ya tiene esa etiqueta. Al cambiar la
 * etiqueta, la tarea pasa al final de su nuevo grupo.
 * @param {import('../entities/Task.js').Priority | null} priority
 */
export function setPriority(tasks, { id, priority }) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.priority === priority) return null;
  return { priority, order: nextOrder(tasks) };
}
