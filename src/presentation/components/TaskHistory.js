// Historial de la tarjeta: la línea de tiempo con las fechas en que la tarea entró en cada estado (el
// resumen), la anotación de las tareas que volvieron de En curso a Pendiente y el control que despliega
// el historial completo de cambios (docs/PLAN_USUARIOS.md, 4.6).
import { STATUSES, STATUS_DATE_FIELDS, wasInProgress } from '../../domain/entities/Task.js';
import { effectiveHistory } from '../../domain/rules/history.js';
import { stalledDays } from '../../domain/rules/stalledTasks.js';
import { formatDate, fullDateFormat, historyEventText, shortDateFormat } from '../format/dates.js';
import { HISTORY_TEXTS, PENDING_SINCE_LABEL, STATUS_LABELS } from '../format/labels.js';

// Tareas con el historial completo desplegado. El tablero vuelve a crear las tarjetas en cada cambio
// (también al sincronizar), así que se recuerda aquí para que no se plieguen solas.
const expandedIds = new Set();

// Control "Ver historial" con el foco, para pasárselo al de la tarjeta nueva si la suya se vuelve a
// crear mientras lo tenía.
let focusedToggle = null;

// La fecha de Pendiente de una tarea devuelta es la del regreso, no la de creación (B-4.1).
export function stepLabel(task, status) {
  return status === 'pending' && wasInProgress(task) ? PENDING_SINCE_LABEL : STATUS_LABELS[status];
}

// Del más reciente al más antiguo; con la misma hora, primero el último añadido.
export function newestFirst(events) {
  return [...events].reverse().sort((a, b) => b.at - a.at);
}

export function createTaskHistory(task) {
  // Permiso history (docs/PLAN_USUARIOS.md, 3.2 y 3.4): todavía no existe. El PR 8 lo conectará aquí
  // con presentation/state/features.js; apagado, la tarjeta no muestra el historial, que se sigue
  // registrando.
  const fragment = document.createDocumentFragment();
  fragment.append(createTimeline(task));
  if (wasInProgress(task)) fragment.append(createReturnNote(task));

  const events = effectiveHistory(task);
  if (events.length > 0) fragment.append(...createFullHistory(task, events));
  return fragment;
}

function createTime(ms) {
  const time = document.createElement('time');
  time.dateTime = new Date(ms).toISOString();
  time.title = fullDateFormat.format(ms);
  time.textContent = formatDate(ms);
  return time;
}

function createTimeline(task) {
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
    label.textContent = stepLabel(task, status);

    item.append(label, createTime(ms));
    list.append(item);
  });
  return list;
}

function createReturnNote(task) {
  const note = document.createElement('p');
  note.className = 'history-note';
  note.title = `Estuvo en curso desde el ${fullDateFormat.format(task.startedAt)} y luego volvió a Pendiente`;
  note.textContent = `↩ Ya estuvo en curso desde el ${shortDateFormat.format(task.startedAt)}`;
  return note;
}

// Botón con aria-expanded y la lista que despliega, del evento más reciente al más antiguo.
function createFullHistory(task, events) {
  const listId = `history-${task.id}`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'history-toggle';
  toggle.textContent = HISTORY_TEXTS.toggle(events.length);
  toggle.setAttribute('aria-controls', listId);
  toggle.dataset.taskId = task.id;

  const list = document.createElement('ol');
  list.id = listId;
  list.className = 'history-events';
  list.setAttribute('aria-label', HISTORY_TEXTS.listLabel);
  newestFirst(events).forEach((event) => list.append(createEvent(event)));

  const show = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
  };
  show(expandedIds.has(task.id));

  toggle.addEventListener('click', () => {
    const open = !expandedIds.has(task.id);
    if (open) expandedIds.add(task.id);
    else expandedIds.delete(task.id);
    show(open);
  });

  toggle.addEventListener('focus', () => {
    focusedToggle = toggle;
  });
  // Si sigue en la página, el foco se fue a otra parte; si no, se quitó al redibujar y se recuerda.
  toggle.addEventListener('blur', () => {
    queueMicrotask(() => {
      if (focusedToggle === toggle && toggle.isConnected) focusedToggle = null;
    });
  });
  // Tras redibujar, el foco vuelve aquí si lo tenía el control de esta tarea y no pasó a otro sitio.
  queueMicrotask(() => {
    const previous = focusedToggle;
    if (!previous || previous === toggle || previous.isConnected || previous.dataset.taskId !== task.id) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost && toggle.isConnected) toggle.focus({ preventScroll: true });
  });

  return [toggle, list];
}

function createEvent(event) {
  const item = document.createElement('li');
  item.className = 'history-event';

  const text = document.createElement('span');
  text.className = 'history-event-text';
  text.textContent = historyEventText(event);
  item.append(text);

  if (event.derived) {
    const derived = document.createElement('span');
    derived.className = 'history-derived';
    derived.textContent = HISTORY_TEXTS.derived;
    item.append(derived);
  }

  item.append(createTime(event.at));
  return item;
}
