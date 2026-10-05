// Línea de tiempo con las fechas en que la tarea entró en cada estado, más la anotación de las
// tareas que volvieron de En curso a Pendiente.
import { STATUSES, STATUS_DATE_FIELDS, wasInProgress } from '../../domain/entities/Task.js';
import { stalledDays } from '../../domain/rules/stalledTasks.js';
import { formatDate, fullDateFormat, shortDateFormat } from '../format/dates.js';
import { STATUS_LABELS } from '../format/labels.js';

export function createTaskHistory(task) {
  const list = document.createElement('ol');
  list.className = 'task-history';
  list.setAttribute('aria-label', 'Historial de estados');

  // Solo se muestran los estados alcanzados hasta la columna actual; la fecha de En curso de
  // una tarea devuelta a Pendiente se muestra aparte, como anotación.
  STATUSES.slice(0, STATUSES.indexOf(task.status) + 1).forEach((status) => {
    const ms = task[STATUS_DATE_FIELDS[status]];
    if (ms === null) return;

    const item = document.createElement('li');
    item.className = 'history-step';
    item.dataset.status = status;
    // Marca la fecha desde la que se cuenta la alerta de la tarea.
    if (status === task.status && stalledDays(task) !== null) item.classList.add('is-overdue');

    const label = document.createElement('span');
    label.className = 'history-label';
    label.textContent = STATUS_LABELS[status];

    const time = document.createElement('time');
    time.dateTime = new Date(ms).toISOString();
    time.title = fullDateFormat.format(ms);
    time.textContent = formatDate(ms);

    item.append(label, time);
    list.append(item);
  });

  if (!wasInProgress(task)) return list;

  const note = document.createElement('p');
  note.className = 'history-note';
  note.title = `Estuvo en curso desde el ${fullDateFormat.format(task.startedAt)} y luego volvió a Pendiente`;
  note.textContent = `↩ Ya estuvo en curso desde el ${shortDateFormat.format(task.startedAt)}`;

  const fragment = document.createDocumentFragment();
  fragment.append(list, note);
  return fragment;
}
