// Borrar una subtarea (docs/PLAN_SUBTAREAS.md, 2.7). La confirmación la pide la vista.
import { subtaskChanges, subtasksOf } from '../rules/subtasks.js';

/**
 * En una tarea completada no se borran (P-8). Sin subtareas, la tarea vuelve al flujo de siempre.
 * @param {import('../entities/Task.js').Task[]} tasks
 * @param {{ id: string, subtaskId: string }} input
 * @returns {{ ok: true, changes: { subtasks: import('../entities/Task.js').Subtask[], openSubtasks: number } }
 *   | { ok: false, reason: 'not-found' | 'completed' }}
 */
export function removeSubtask(tasks, { id, subtaskId }) {
  const task = tasks.find((t) => t.id === id);
  const subtasks = task ? subtasksOf(task) : [];
  if (!task || !subtasks.some((s) => s.id === subtaskId)) return { ok: false, reason: 'not-found' };
  if (task.status === 'completed') return { ok: false, reason: 'completed' };
  return { ok: true, changes: subtaskChanges(subtasks.filter((s) => s.id !== subtaskId)) };
}
