// Agregar una subtarea al final de la lista de una tarea (docs/PLAN_SUBTAREAS.md, 2.4).
import {
  SUBTASK_LIMIT,
  normalizeSubtaskText,
  subtaskChanges,
  subtaskTextProblem,
  subtasksOf,
} from '../rules/subtasks.js';

/**
 * Nace pendiente. Una tarea completada no admite subtareas nuevas (P-8): habría que reabrirla.
 * @param {import('../entities/Task.js').Task[]} tasks
 * @param {{ id: string, subtaskId: string, text: string }} input
 * @returns {{ ok: true, changes: { subtasks: import('../entities/Task.js').Subtask[], openSubtasks: number } }
 *   | { ok: false, reason: 'not-found' | 'completed' | 'limit' | 'empty' | 'too-long' }}
 */
export function addSubtask(tasks, { id, subtaskId, text }) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, reason: 'not-found' };
  if (task.status === 'completed') return { ok: false, reason: 'completed' };
  const subtasks = subtasksOf(task);
  if (subtasks.length >= SUBTASK_LIMIT) return { ok: false, reason: 'limit' };
  const clean = normalizeSubtaskText(text);
  const problem = subtaskTextProblem(clean);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, changes: subtaskChanges([...subtasks, { id: subtaskId, text: clean, done: false }]) };
}
