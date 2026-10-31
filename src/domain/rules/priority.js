// Orden por etiqueta de prioridad: Urgente, Prioritaria, Puede esperar y al final sin etiqueta.
import { PRIORITY_LEVELS } from '../entities/Task.js';
import { ALL_FEATURES } from './features.js';

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

/**
 * Orden de una columna en el tablero: por etiqueta solo con la función priorities activa; si no, queda el
 * orden manual con el que llega la lista (docs/PLAN_USUARIOS.md, 3.1). Ordena la lista recibida (la
 * modifica) y la devuelve.
 * @param {import('../entities/Task.js').Task[]} list
 * @param {import('./features.js').FeatureFlags} [features] Permisos efectivos de la persona.
 */
export function sortForView(list, features = ALL_FEATURES) {
  return features.priorities === true ? sortByPriority(list) : list;
}
