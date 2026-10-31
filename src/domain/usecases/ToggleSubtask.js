// Marcar una subtarea como terminada o volverla a pendiente (docs/PLAN_SUBTAREAS.md, 2.4 a 2.6).
import { datesForStatus } from '../entities/Task.js';
import { WIP_LIMITS, isColumnFull, nextOrder } from '../rules/board.js';
import { subtaskChanges, subtasksOf } from '../rules/subtasks.js';

/**
 * Marcar nunca completa la tarea: completar es siempre una acción aparte (moveTask). Volver a pendiente una
 * subtarea de una tarea completada la reabre: hace falta reopen (la persona lo confirmó) y la tarea pasa a
 * En curso, al final, en la misma escritura; si no, las reglas rechazarían una completada con pendientes.
 * @param {import('../entities/Task.js').Task[]} tasks Tablero actual, ordenado.
 * @param {{ id: string, subtaskId: string, done: boolean, reopen?: boolean, now?: number }} input
 * @returns {{ ok: true, changes: object }
 *   | { ok: false, reason: 'not-found' | 'unchanged' | 'needs-reopen' }
 *   | { ok: false, reason: 'wip-limit', limit: number }}
 */
export function toggleSubtask(tasks, { id, subtaskId, done, reopen = false, now = Date.now() }) {
  const task = tasks.find((t) => t.id === id);
  const subtasks = task ? subtasksOf(task) : [];
  const subtask = subtasks.find((s) => s.id === subtaskId);
  if (!task || !subtask) return { ok: false, reason: 'not-found' };
  if (subtask.done === done) return { ok: false, reason: 'unchanged' };

  const changes = subtaskChanges(subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)));
  if (task.status !== 'completed' || done) return { ok: true, changes };

  if (!reopen) return { ok: false, reason: 'needs-reopen' };
  if (isColumnFull(tasks, 'in-progress')) return { ok: false, reason: 'wip-limit', limit: WIP_LIMITS['in-progress'] };
  const order = nextOrder(tasks.filter((t) => t.id !== id));
  return { ok: true, changes: { ...changes, status: 'in-progress', order, ...datesForStatus('in-progress', now) } };
}
