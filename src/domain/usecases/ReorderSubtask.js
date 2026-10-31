// Subir o bajar una subtarea un puesto en la lista (docs/PLAN_SUBTAREAS.md, 2.10): el orden es la posición.
import { subtaskChanges, subtasksOf } from '../rules/subtasks.js';

/**
 * @param {import('../entities/Task.js').Task[]} tasks
 * @param {{ id: string, subtaskId: string, direction: -1 | 1 }} input -1 sube, 1 baja.
 * @returns {{ ok: true, changes: { subtasks: import('../entities/Task.js').Subtask[], openSubtasks: number } }
 *   | { ok: false, reason: 'not-found' | 'completed' | 'edge' }}
 */
export function reorderSubtask(tasks, { id, subtaskId, direction }) {
  const task = tasks.find((t) => t.id === id);
  const subtasks = task ? subtasksOf(task) : [];
  const index = subtasks.findIndex((s) => s.id === subtaskId);
  if (!task || index === -1) return { ok: false, reason: 'not-found' };
  if (task.status === 'completed') return { ok: false, reason: 'completed' };
  const target = index + direction;
  if (target < 0 || target >= subtasks.length) return { ok: false, reason: 'edge' };
  const next = [...subtasks];
  [next[index], next[target]] = [next[target], next[index]];
  return { ok: true, changes: subtaskChanges(next) };
}
