// Menú para poner, cambiar o quitar la etiqueta y la fecha límite de una tarea ya creada.
// data-menu-key permite devolver el foco al mismo control después de redibujar.
import { DUE_DATE_PATTERN } from '../../domain/entities/Task.js';
import { PRIORITIES } from '../format/labels.js';

/**
 * @param {import('../../domain/entities/Task.js').Task} task
 * @param {{ onPriority: (priority: string | null) => void, onDueDate: (dueDate: string | null) => void,
 *   onClose: (restoreFocus: boolean) => void }} handlers
 */
export function createLabelMenu(task, { onPriority, onDueDate, onClose }) {
  const menu = document.createElement('div');
  menu.className = 'label-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Etiqueta y fecha límite');
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(true);
    }
  });

  const title = document.createElement('p');
  title.className = 'label-menu-title';
  title.textContent = 'Prioridad';

  const options = document.createElement('div');
  options.className = 'label-options';
  [...Object.keys(PRIORITIES), null].forEach((priority) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `label-option tag tag-${priority ?? 'none'}`;
    option.dataset.menuKey = `priority-${priority ?? 'none'}`;
    option.textContent = priority ? `${PRIORITIES[priority].icon} ${PRIORITIES[priority].label}` : 'Sin etiqueta';
    option.setAttribute('aria-pressed', String(task.priority === priority));
    option.addEventListener('click', () => {
      onPriority(priority);
      onClose(true);
    });
    options.append(option);
  });

  const dueLabel = document.createElement('label');
  dueLabel.className = 'label-menu-title';
  dueLabel.textContent = 'Fecha límite (opcional)';
  dueLabel.htmlFor = `due-${task.id}`;

  const dueRow = document.createElement('div');
  dueRow.className = 'label-due';

  const dueInput = document.createElement('input');
  dueInput.type = 'date';
  dueInput.id = `due-${task.id}`;
  dueInput.className = 'due-input';
  dueInput.value = task.dueDate ?? '';
  dueInput.dataset.menuKey = 'due';
  dueInput.addEventListener('change', () => {
    if (dueInput.value === '' || DUE_DATE_PATTERN.test(dueInput.value)) onDueDate(dueInput.value || null);
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'due-clear';
  clearBtn.textContent = 'Quitar';
  clearBtn.dataset.menuKey = 'due-clear';
  clearBtn.disabled = task.dueDate === null;
  clearBtn.addEventListener('click', () => {
    onDueDate(null);
    // El botón queda desactivado tras redibujar; el foco pasa al campo de fecha nuevo.
    const input = document.getElementById(dueInput.id);
    if (input) input.focus({ preventScroll: true });
  });

  dueRow.append(dueInput, clearBtn);
  menu.append(title, options, dueLabel, dueRow);
  return menu;
}
