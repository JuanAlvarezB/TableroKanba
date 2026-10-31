// Mover una tarea de columna o reordenarla dentro de la misma.
import { STATUSES, datesForStatus } from '../entities/Task.js';
import { WIP_LIMITS, isColumnFull, nextOrder, orderBefore } from '../rules/board.js';
import { completionBlock } from '../rules/subtasks.js';

/**
 * Mueve la tarea a `status`; si se indica beforeId, la coloca antes de esa tarea y, si no, al
 * final. Reordenar dentro de la misma columna no cambia el historial de fechas. Una tarea con
 * subtareas pendientes no pasa a Completada (docs/PLAN_SUBTAREAS.md, 2.5); la confirmación de
 * completar con todas terminadas la pide la vista.
 * @param {import('../entities/Task.js').Task[]} tasks Tablero actual, ordenado.
 * @returns {{ ok: true, tasks: import('../entities/Task.js').Task[], task: import('../entities/Task.js').Task, changes: object }
 *   | { ok: false, reason: 'not-found' }
 *   | { ok: false, reason: 'wip-limit', limit: number }
 *   | { ok: false, reason: 'open-subtasks', open: number, total: number, pending: string[] }}
 */
export function moveTask(tasks, { id, status, beforeId = null, now = Date.now() }) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, reason: 'not-found' };
  const block = status === 'completed' && task.status !== 'completed' ? completionBlock(task) : null;
  if (block) return { ok: false, ...block };
  if (task.status !== status && isColumnFull(tasks, status)) {
    return { ok: false, reason: 'wip-limit', limit: WIP_LIMITS[status] };
  }

  const dates = task.status === status ? {} : datesForStatus(status, now);
  const rest = tasks.filter((t) => t.id !== id);
  const beforeIndex = beforeId === null ? -1 : rest.findIndex((t) => t.id === beforeId);
  const order = beforeIndex === -1 ? nextOrder(rest) : orderBefore(rest, beforeIndex);
  const moved = { ...task, status, ...dates, order };

  const next = [...rest];
  if (beforeIndex === -1) next.push(moved);
  else next.splice(beforeIndex, 0, moved);
  return { ok: true, tasks: next, task: moved, changes: { status, order, ...dates } };
}

// Columna anterior (direction = -1) o siguiente (+1); null si ya está en el extremo.
export function adjacentStatus(task, direction) {
  return STATUSES[STATUSES.indexOf(task.status) + direction] ?? null;
}
