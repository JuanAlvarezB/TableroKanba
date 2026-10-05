// Tareas detenidas: más de STALLED_DAYS días calendario en Pendiente (desde que se creó) o
// En curso (desde que empezó). Las completadas no generan alertas.
import { STATUS_DATE_FIELDS } from '../entities/Task.js';
import { calendarDaysSince } from './dates.js';

export const STALLED_DAYS = 3;

/** @type {import('../entities/Task.js').Status[]} */
export const STALLED_STATUSES = ['pending', 'in-progress'];

// Días que la tarea lleva detenida en su columna, o null si no supera el límite.
export function stalledDays(task, now = new Date()) {
  if (!STALLED_STATUSES.includes(task.status)) return null;
  const since = task[STATUS_DATE_FIELDS[task.status]];
  if (since === null) return null;
  const days = calendarDaysSince(since, now);
  return days > STALLED_DAYS ? days : null;
}
