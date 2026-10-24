// Crear una tarea: entra en Pendiente, al final del tablero y sin etiquetas.
import { createTask } from '../entities/Task.js';
import { nextOrder } from '../rules/board.js';

/**
 * @param {import('../entities/Task.js').Task[]} tasks Tablero actual, ordenado.
 * @param {{ id: string, text: string, now?: number, history?: import('../entities/Task.js').HistoryEvent[] }} input
 *   history: el evento de creación (historyEventsFor de domain/rules/history.js).
 */
export function addTask(tasks, { id, text, now = Date.now(), history }) {
  const task = createTask({ id, text, order: nextOrder(tasks), now, history });
  return { tasks: [...tasks, task], task };
}
