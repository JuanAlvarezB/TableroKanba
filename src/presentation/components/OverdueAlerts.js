// Alertas del tablero: contadores en el encabezado de cada columna (detenidas, urgentes,
// vencimientos), el resumen de tareas que necesitan atención y el aviso de recordatorio.
import { FILTERS } from '../../domain/rules/board.js';
import { DUE_SOON_BUSINESS_DAYS } from '../../domain/rules/dueDates.js';
import { attentionIds } from '../../domain/rules/reminders.js';
import { STALLED_DAYS, stalledDays } from '../../domain/rules/stalledTasks.js';
import { OVERDUE_COLUMNS, plural } from '../format/labels.js';

// El recordatorio se cierra solo al minuto. Las etiquetas de las tarjetas y columnas siguen
// visibles todo el tiempo.
const REMINDER_DURATION = 60000;

// Muestra un contador en el encabezado de la columna, o lo oculta si es cero.
function setColumnChip(selector, text, title, count) {
  const chip = document.querySelector(selector);
  if (!chip) return;
  chip.textContent = text;
  chip.title = title;
  chip.classList.toggle('hidden', count === 0);
}

export function renderColumnChips(tasks) {
  Object.entries(OVERDUE_COLUMNS).forEach(([status, { phrase }]) => {
    const columnTasks = tasks.filter((t) => t.status === status);
    const overdue = columnTasks.filter((t) => stalledDays(t) !== null).length;
    const urgent = columnTasks.filter((t) => t.priority === 'urgent').length;
    const due = columnTasks.filter(FILTERS.due).length;
    setColumnChip(
      `[data-alert="${status}"]`,
      `⏰ ${overdue}`,
      `${plural(overdue, 'tarea lleva', 'tareas llevan')} más de ${STALLED_DAYS} días ${phrase}`,
      overdue,
    );
    setColumnChip(
      `[data-urgent="${status}"]`,
      `🔴 ${urgent}`,
      plural(urgent, 'tarea urgente', 'tareas urgentes'),
      urgent,
    );
    setColumnChip(
      `[data-due="${status}"]`,
      `⏳ ${due}`,
      `${plural(due, 'tarea vencida o', 'tareas vencidas o')} próximas a vencer`,
      due,
    );
  });
}

// Grupos de tareas que el recordatorio menciona, con sus textos: detenidas por columna,
// urgentes, vencidas y próximas a vencer (la selección está en domain/rules/reminders.js).
// Solo se devuelven los que tienen alguna tarea.
export function attentionGroups(tasks) {
  const { stalled, urgent, overdueDue, soonDue } = attentionIds(tasks);
  const groups = Object.entries(OVERDUE_COLUMNS).map(([status, { name, phrase }]) => ({
    ids: stalled[status],
    text: `${plural(stalled[status].length, 'tarea lleva', 'tareas llevan')} más de ${STALLED_DAYS} días ${phrase}.`,
    label: `Ver tareas detenidas en ${name}`,
  }));
  groups.push(
    {
      ids: urgent,
      text: `${plural(urgent.length, 'tarea urgente', 'tareas urgentes')} sin completar.`,
      label: 'Ver tareas urgentes',
    },
    {
      ids: overdueDue,
      text: `${plural(overdueDue.length, 'tarea vencida', 'tareas vencidas')}.`,
      label: 'Ver tareas vencidas',
    },
    {
      ids: soonDue,
      text: `${plural(soonDue.length, 'tarea vence', 'tareas vencen')} en ${DUE_SOON_BUSINESS_DAYS} días hábiles o menos.`,
      label: 'Ver tareas próximas a vencer',
    },
  );
  return groups.filter((g) => g.ids.length > 0);
}

/**
 * Aviso de recordatorio (#overdue-banner) con el resumen de tareas que necesitan atención.
 * @param {{ banner: HTMLElement, title: HTMLElement, summary: HTMLElement, dismiss: HTMLElement }} elements
 * @param {{ onShowTasks: (ids: string[]) => void }} handlers
 */
export function createReminderBanner({ banner, title, summary, dismiss }, { onShowTasks }) {
  let timeout = null;

  function hide() {
    clearTimeout(timeout);
    banner.classList.add('hidden');
    banner.classList.remove('counting');
  }

  dismiss.addEventListener('click', hide);

  return {
    hide,

    show(slot) {
      title.textContent = `Recordatorio ${slot.label}: hay tareas que necesitan atención`;
      banner.classList.remove('hidden', 'counting');
      // Reinicia la barra de tiempo restante.
      void banner.offsetWidth;
      banner.classList.add('counting');
      clearTimeout(timeout);
      timeout = setTimeout(hide, REMINDER_DURATION);
    },

    renderSummary(groups) {
      summary.innerHTML = '';
      groups.forEach(({ ids, text, label }) => {
        const item = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = text;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'overdue-show';
        button.textContent = 'Ver';
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => onShowTasks(ids));
        item.append(span, button);
        summary.append(item);
      });
    },
  };
}
