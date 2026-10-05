// Orden por etiqueta de prioridad: Urgente, Prioritaria, Puede esperar y al final sin etiqueta.
import { PRIORITY_LEVELS } from '../entities/Task.js';

const NO_PRIORITY_RANK = PRIORITY_LEVELS.length;

export function priorityRank(task) {
  return task.priority === null ? NO_PRIORITY_RANK : PRIORITY_LEVELS.indexOf(task.priority);
}

// Orden dentro de una columna: por etiqueta y, dentro de cada etiqueta, por el orden manual.
// sort es estable, así que basta con comparar la etiqueta si la lista ya viene por "order".
// Ordena la lista recibida (la modifica) y la devuelve.
export function sortByPriority(list) {
  return list.sort((a, b) => priorityRank(a) - priorityRank(b));
}
