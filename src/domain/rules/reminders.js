// Recordatorio de tareas que necesitan atención: sale de lunes a viernes una vez en la mañana
// (desde las 10:00) y otra en la tarde (desde las 15:00).
import { dueStatus } from './dueDates.js';
import { STALLED_STATUSES, stalledDays } from './stalledTasks.js';

export const REMINDER_SLOTS = [
  { hour: 10, label: 'de la mañana' },
  { hour: 15, label: 'de la tarde' },
];

// Turno de recordatorio vigente ({ id: "2026-10-5@10", label }), o null en fin de semana
// o antes de las 10:00. Si la página se abre más tarde, el turno sigue pendiente.
export function currentReminderSlot(now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day === 6) return null;
  const slot = [...REMINDER_SLOTS].reverse().find((s) => now.getHours() >= s.hour);
  if (!slot) return null;
  return { id: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}@${slot.hour}`, label: slot.label };
}

/**
 * Ids de las tareas que el recordatorio menciona: detenidas por columna, urgentes, vencidas y
 * próximas a vencer (sin contar las completadas).
 */
export function attentionIds(tasks, now = new Date()) {
  const open = tasks.filter((t) => t.status !== 'completed');
  const idsOf = (list) => list.map((t) => t.id);
  return {
    stalled: Object.fromEntries(
      STALLED_STATUSES.map((status) => [
        status,
        idsOf(tasks.filter((t) => t.status === status && stalledDays(t, now) !== null)),
      ]),
    ),
    urgent: idsOf(open.filter((t) => t.priority === 'urgent')),
    overdueDue: idsOf(open.filter((t) => dueStatus(t, now)?.kind === 'overdue')),
    soonDue: idsOf(open.filter((t) => dueStatus(t, now)?.kind === 'soon')),
  };
}
