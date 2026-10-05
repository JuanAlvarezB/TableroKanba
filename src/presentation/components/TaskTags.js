// Etiquetas de la tarjeta: prioridad y vencimiento (como máximo dos).
import { dueInfo } from '../format/dates.js';
import { PRIORITIES } from '../format/labels.js';

export function createTaskTags(task) {
  const due = dueInfo(task);
  if (!task.priority && !due) return null;

  const tags = document.createElement('div');
  tags.className = 'card-tags';
  if (task.priority) {
    const { icon, label } = PRIORITIES[task.priority];
    const tag = document.createElement('span');
    tag.className = `tag tag-${task.priority}`;
    tag.textContent = `${icon} ${label}`;
    tags.append(tag);
  }
  if (due) {
    const tag = document.createElement('span');
    tag.className = `tag tag-due-${due.kind}`;
    tag.textContent = due.text;
    tag.title = due.title;
    tags.append(tag);
  }
  return tags;
}
