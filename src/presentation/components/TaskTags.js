// Etiquetas de la tarjeta: prioridad y vencimiento (como máximo dos). Cada una solo con su función
// activa (priorities y dueDates); apagada se oculta, sin borrar el valor guardado (docs/PLAN_USUARIOS.md, 3.4).
import { dueInfo } from '../format/dates.js';
import { PRIORITIES } from '../format/labels.js';
import { currentFeatures } from '../state/features.js';

export function createTaskTags(task) {
  const features = currentFeatures();
  const priority = features.priorities ? task.priority : null;
  const due = features.dueDates ? dueInfo(task) : null;
  if (!priority && !due) return null;

  const tags = document.createElement('div');
  tags.className = 'card-tags';
  if (priority) {
    const { icon, label } = PRIORITIES[priority];
    const tag = document.createElement('span');
    tag.className = `tag tag-${priority}`;
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
