// Cambiar el texto de una subtarea (docs/PLAN_SUBTAREAS.md, 2.4 y 2.6).
import { normalizeSubtaskText, subtaskChanges, subtaskTextProblem, subtasksOf } from '../rules/subtasks.js';

/**
 * Un texto vacío no la borra: se rechaza y se mantiene el anterior. En una tarea completada no se edita (P-8).
 * @param {import('../entities/Task.js').Task[]} tasks
 * @param {{ id: string, subtaskId: string, text: string }} input
 * @returns {{ ok: true, changes: { subtasks: import('../entities/Task.js').Subtask[], openSubtasks: number } }
 *   | { ok: false, reason: 'not-found' | 'completed' | 'empty' | 'too-long' | 'unchanged' }}
 */
export function editSubtask(tasks, { id, subtaskId, text }) {
  const task = tasks.find((t) => t.id === id);
  const subtasks = task ? subtasksOf(task) : [];
  const subtask = subtasks.find((s) => s.id === subtaskId);
  if (!task || !subtask) return { ok: false, reason: 'not-found' };
  if (task.status === 'completed') return { ok: false, reason: 'completed' };
  const clean = normalizeSubtaskText(text);
  const problem = subtaskTextProblem(clean);
  if (problem) return { ok: false, reason: problem };
  if (clean === subtask.text) return { ok: false, reason: 'unchanged' };
  return { ok: true, changes: subtaskChanges(subtasks.map((s) => (s.id === subtaskId ? { ...s, text: clean } : s))) };
}
