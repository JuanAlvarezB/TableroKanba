// Crear una tarea: entra en Pendiente, al final del tablero y sin etiquetas.
import { createTask } from '../entities/Task.js';
import { nextOrder } from '../rules/board.js';

/**
 * @param {import('../entities/Task.js').Task[]} tasks Tablero actual, ordenado.
 * @param {{ id: string, text: string, now?: number }} input
 */
export function addTask(tasks, { id, text, now = Date.now() }) {
  const task = createTask({ id, text, order: nextOrder(tasks), now });
  return { tasks: [...tasks, task], task };
}
