// Decide si toca mostrar el recordatorio: hay turno vigente (lunes a viernes, 10:00 o 15:00),
// aún no se mostró en este navegador y hay tareas que necesitan atención.
import { attentionIds, currentReminderSlot } from '../rules/reminders.js';

/**
 * @param {import('../entities/Task.js').Task[]} tasks
 * @param {{ lastShownId: string | null, now?: Date }} input
 * @returns {{ id: string, label: string } | null} El turno que hay que mostrar, o null.
 */
export function checkReminder(tasks, { lastShownId, now = new Date() }) {
  const slot = currentReminderSlot(now);
  if (!slot || lastShownId === slot.id) return null;
  const { stalled, urgent, overdueDue, soonDue } = attentionIds(tasks, now);
  const groups = [...Object.values(stalled), urgent, overdueDue, soonDue];
  return groups.some((ids) => ids.length > 0) ? slot : null;
}
