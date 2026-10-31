// Fechas en español para las tarjetas, textos de vencimiento y eventos del historial.
import { dueStatus, parseDueDate } from '../../domain/rules/dueDates.js';
import { COLUMN_NAMES, HISTORY_TEXTS, PRIORITIES, plural } from './labels.js';

const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormatWithYear = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const shortDateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full' });
export const fullDateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });

// El año solo se muestra si no es el actual, para que la fecha ocupe poco en la tarjeta.
export function formatDate(ms, now = new Date()) {
  const date = new Date(ms);
  const format = date.getFullYear() === now.getFullYear() ? dateFormat : dateFormatWithYear;
  return format.format(date);
}

// Vencimiento con sus textos ({ kind, text, title }), o null si no tiene fecha o ya se completó.
// La regla está en domain/rules/dueDates.js.
export function dueInfo(task, now = new Date()) {
  const status = dueStatus(task, now);
  if (!status) return null;
  const { kind, days, due } = status;
  const title = `Fecha límite: ${longDateFormat.format(due)}`;

  if (kind === 'overdue') return { kind, text: `⛔ Venció hace ${plural(-days, 'día', 'días')}`, title };
  if (kind === 'soon') {
    const text = days === 0 ? '⏳ Vence hoy' : days === 1 ? '⏳ Vence mañana' : `⏳ Vence en ${days} días`;
    return { kind, text, title };
  }
  return { kind, text: `📅 Vence el ${shortDateFormat.format(due)}`, title };
}

// Texto de un evento del historial, sin su hora ni la marca de derivado (las pone TaskHistory).
// Los valores ausentes (sin etiqueta, sin fecha) se nombran para que se lea el antes y el después.
const priorityText = (value) => (value ? PRIORITIES[value].label : HISTORY_TEXTS.noPriority);
const dueDateText = (value) => (value ? dayFormat.format(parseDueDate(value)) : HISTORY_TEXTS.noDueDate);
const EVENT_TEXTS = {
  create: ({ text }) => `Creada: «${text}»`,
  edit: ({ from, to }) => `Texto: «${from}» → «${to}»`,
  move: ({ from, to }) =>
    from === null ? `Entró en ${COLUMN_NAMES[to]}` : `Movida de ${COLUMN_NAMES[from]} a ${COLUMN_NAMES[to]}`,
  priority: ({ from, to }) => `Prioridad: ${priorityText(from)} → ${priorityText(to)}`,
  due: ({ from, to }) => `Fecha límite: ${dueDateText(from)} → ${dueDateText(to)}`,
  // Avance de una subtarea (docs/PLAN_SUBTAREAS.md, 2.8).
  subtask: ({ text, to }) =>
    to === 'done' ? `Subtarea terminada: «${text}»` : `Subtarea pendiente otra vez: «${text}»`,
};

/** @param {import('../../domain/entities/Task.js').HistoryEvent} event */
export function historyEventText(event) {
  return EVENT_TEXTS[event.type](event);
}
