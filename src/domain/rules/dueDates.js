// Fecha límite opcional de una tarea: se marca "próxima a vencer" cuando faltan
// DUE_SOON_BUSINESS_DAYS días hábiles o menos, y "vencida" cuando ya pasó.
import { businessDaysUntil, calendarDaysSince } from './dates.js';

export const DUE_SOON_BUSINESS_DAYS = 2;

// "2026-10-15" → medianoche local de ese día.
export function parseDueDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Estado del vencimiento, o null si no tiene fecha o ya se completó.
 * kind: "overdue" (vencida), "soon" (próxima a vencer) o "scheduled" (aún con margen).
 * days: días calendario que faltan (negativo si ya venció).
 * @returns {{ kind: 'overdue' | 'soon' | 'scheduled', days: number, due: Date } | null}
 */
export function dueStatus(task, now = new Date()) {
  if (task.dueDate === null || task.status === 'completed') return null;
  const due = parseDueDate(task.dueDate);
  // "|| 0" evita devolver -0 cuando vence hoy.
  const days = -calendarDaysSince(due.getTime(), now) || 0;

  if (days < 0) return { kind: 'overdue', days, due };
  if (days === 0 || businessDaysUntil(due, DUE_SOON_BUSINESS_DAYS, now) <= DUE_SOON_BUSINESS_DAYS) {
    return { kind: 'soon', days, due };
  }
  return { kind: 'scheduled', days, due };
}

// Vencida o próxima a vencer: lo que el filtro "Próximas a vencer" y los avisos destacan.
export function needsDueAttention(task, now = new Date()) {
  return ['soon', 'overdue'].includes(dueStatus(task, now)?.kind);
}
