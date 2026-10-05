// Tarjeta de una tarea: texto, etiquetas, alerta de tarea detenida, historial y acciones.
import { STATUSES } from '../../domain/entities/Task.js';
import { STALLED_DAYS, stalledDays } from '../../domain/rules/stalledTasks.js';
import { OVERDUE_COLUMNS } from '../format/labels.js';
import { createLabelMenu } from './LabelMenu.js';
import { createTaskHistory } from './TaskHistory.js';
import { createTaskTags } from './TaskTags.js';

// Las tareas completadas quedan cerradas: su texto ya no se puede modificar.
export function isEditable(task) {
  return task.status !== 'completed';
}

/**
 * @param {import('../../domain/entities/Task.js').Task} task
 * @param {object} ctx
 * @param {boolean} ctx.menuOpen Si esta tarjeta tiene abierto el menú de etiquetas.
 * @param {number | null} ctx.highlightElapsed ms desde que empezó su resaltado, o null.
 * @param {object} ctx.actions startEdit, shift, toggleLabelMenu, remove, dragStart, dragEnd y los
 *   del menú de etiquetas (setPriority, setDueDate, closeLabelMenu).
 */
export function createTaskCard(task, { menuOpen, highlightElapsed, actions }) {
  const li = document.createElement('li');
  li.className = `card ${task.status}`;
  // Con el menú de etiquetas abierto no se arrastra, para poder usar la fecha con el ratón.
  li.draggable = !menuOpen;
  li.dataset.id = task.id;
  li.dataset.priority = task.priority ?? '';
  if (task.priority) li.classList.add(`priority-${task.priority}`);

  // El resaltado continúa donde iba aunque la tarjeta se haya vuelto a crear.
  if (highlightElapsed !== null) {
    li.classList.add('flash');
    li.style.animationDelay = `${-highlightElapsed}ms`;
  }

  li.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
    li.classList.add('dragging');
    actions.dragStart(task.id);
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    actions.dragEnd();
  });

  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;
  if (isEditable(task)) {
    span.title = 'Doble clic para editar';
    span.addEventListener('dblclick', () => actions.startEdit(task.id));
  }

  const actionsBar = document.createElement('div');
  actionsBar.className = 'card-actions';

  const index = STATUSES.indexOf(task.status);

  const backBtn = document.createElement('button');
  backBtn.className = 'move-btn';
  backBtn.textContent = '←';
  backBtn.title = 'Mover a la columna anterior';
  backBtn.disabled = index === 0;
  backBtn.addEventListener('click', () => actions.shift(task.id, -1));

  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'move-btn';
  forwardBtn.textContent = '→';
  forwardBtn.title = 'Mover a la columna siguiente';
  forwardBtn.disabled = index === STATUSES.length - 1;
  forwardBtn.addEventListener('click', () => actions.shift(task.id, 1));

  const editBtn = document.createElement('button');
  editBtn.className = 'edit-btn';
  editBtn.textContent = '✏️';
  editBtn.title = 'Editar tarea';
  editBtn.setAttribute('aria-label', 'Editar tarea');
  editBtn.addEventListener('click', () => actions.startEdit(task.id));

  const labelBtn = document.createElement('button');
  labelBtn.className = 'label-btn';
  labelBtn.textContent = '🏷️';
  labelBtn.title = 'Etiqueta y fecha límite';
  labelBtn.setAttribute('aria-label', 'Etiqueta y fecha límite');
  labelBtn.setAttribute('aria-expanded', String(menuOpen));
  labelBtn.addEventListener('click', () => actions.toggleLabelMenu(task.id));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Eliminar tarea';
  deleteBtn.setAttribute('aria-label', 'Eliminar tarea');
  deleteBtn.addEventListener('click', () => actions.remove(task.id));

  actionsBar.append(backBtn, forwardBtn);
  if (isEditable(task)) actionsBar.append(labelBtn, editBtn);
  actionsBar.append(deleteBtn);

  const tags = createTaskTags(task);
  if (tags) li.append(tags);

  const days = stalledDays(task);
  if (days !== null) {
    li.classList.add('overdue');
    const badge = document.createElement('p');
    badge.className = 'overdue-badge';
    badge.textContent = `⏰ Lleva ${days} días ${OVERDUE_COLUMNS[task.status].phrase}`;
    badge.title = `Supera el límite de ${STALLED_DAYS} días calendario`;
    li.append(badge);
  }

  li.append(span, createTaskHistory(task), actionsBar);
  if (menuOpen) {
    li.append(
      createLabelMenu(task, {
        onPriority: (priority) => actions.setPriority(task.id, priority),
        onDueDate: (dueDate) => actions.setDueDate(task.id, dueDate),
        onClose: (restoreFocus) => actions.closeLabelMenu(restoreFocus),
      }),
    );
  }
  return li;
}
