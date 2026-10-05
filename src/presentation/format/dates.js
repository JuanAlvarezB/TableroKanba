// Fechas en español para las tarjetas y textos de vencimiento.
import { dueStatus } from '../../domain/rules/dueDates.js';
import { plural } from './labels.js';

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
