// Poner, cambiar o quitar la fecha límite.
import { DUE_DATE_PATTERN } from '../entities/Task.js';

/**
 * Campos que cambian, o null si la tarea no existe, ya tiene esa fecha o la fecha no es válida.
 * @param {string | null} dueDate "2026-10-15" o null para quitarla.
 */
export function setDueDate(tasks, { id, dueDate }) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.dueDate === dueDate) return null;
  if (dueDate !== null && !DUE_DATE_PATTERN.test(dueDate)) return null;
  return { dueDate };
}
