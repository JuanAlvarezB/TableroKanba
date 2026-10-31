// Decide si toca mostrar el recordatorio: la función reminders está activa, hay turno vigente
// (lunes a viernes, 10:00 o 15:00), aún no se mostró en este navegador y hay tareas que necesitan
// atención en los grupos de las funciones activas (docs/PLAN_USUARIOS.md, 3.4).
import { ALL_FEATURES } from '../rules/features.js';
import { attentionIds, currentReminderSlot } from '../rules/reminders.js';

/**
 * @param {import('../entities/Task.js').Task[]} tasks
 * @param {{ lastShownId: string | null, now?: Date, features?: import('../rules/features.js').FeatureFlags }} input
 *   features: permisos efectivos de la persona.
 * @returns {{ id: string, label: string } | null} El turno que hay que mostrar, o null.
 */
export function checkReminder(tasks, { lastShownId, now = new Date(), features = ALL_FEATURES }) {
  if (features.reminders !== true) return null;
  const slot = currentReminderSlot(now);
  if (!slot || lastShownId === slot.id) return null;
  const { stalled, urgent, overdueDue, soonDue } = attentionIds(tasks, now, features);
  const groups = [...Object.values(stalled), urgent, overdueDue, soonDue];
  return groups.some((ids) => ids.length > 0) ? slot : null;
}
