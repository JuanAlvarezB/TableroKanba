// Reglas del tablero: orden manual, límites de trabajo en curso y filtros.
import { needsDueAttention } from './dueDates.js';
import { ALL_FEATURES } from './features.js';

// Límite de trabajo en curso (WIP) por columna. Kanban limita lo que está
// "en curso" para terminar tareas antes de empezar otras nuevas.
export const WIP_LIMITS = { 'in-progress': 200 };

// Ordena por "order"; el id desempata tareas creadas a la vez en dos dispositivos.
// Ordena la lista recibida (la modifica) y la devuelve.
export function sortTasks(list) {
  return list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// Orden para una tarea que va al final del tablero (la lista ya está ordenada).
export function nextOrder(tasks) {
  return tasks.length ? tasks[tasks.length - 1].order + 1 : 0;
}

// Orden para colocar una tarea justo antes de tasks[beforeIndex]: queda entre esa tarea y la
// anterior, así solo cambia la tarea que se mueve.
export function orderBefore(tasks, beforeIndex) {
  const next = tasks[beforeIndex].order;
  const prev = beforeIndex > 0 ? tasks[beforeIndex - 1].order : next - 1;
  return (prev + next) / 2;
}

export function countByStatus(tasks, status) {
  return tasks.filter((t) => t.status === status).length;
}

export function isColumnFull(tasks, status) {
  const limit = WIP_LIMITS[status];
  return limit !== undefined && countByStatus(tasks, status) >= limit;
}

// Filtro rápido del tablero: cada uno decide si una tarea se muestra. Reciben solo la tarea
// porque se usan directamente en list.filter() y list.every() (que pasan el índice detrás).
export const FILTERS = {
  all: () => true,
  urgent: (t) => t.priority === 'urgent',
  high: (t) => t.priority === 'high',
  low: (t) => t.priority === 'low',
  none: (t) => t.priority === null,
  due: (t) => needsDueAttention(t),
};

// Función de la que depende cada filtro (docs/PLAN_USUARIOS.md, 3.2); "Todas" no depende de ninguna.
export const FILTER_FEATURES = {
  urgent: 'priorities',
  high: 'priorities',
  low: 'priorities',
  none: 'priorities',
  due: 'dueDates',
};

/**
 * Filtros con los permisos de la persona: el de una función apagada muestra todas las tareas, como
 * "Todas". Su botón está oculto (data-feature) y, si era el filtro activo, el tablero vuelve a mostrarlo
 * todo.
 * @param {import('./features.js').FeatureFlags} [features] Permisos efectivos de la persona.
 * @returns {typeof FILTERS}
 */
export function filtersFor(features = ALL_FEATURES) {
  return Object.fromEntries(
    Object.entries(FILTERS).map(([key, filter]) => {
      const feature = FILTER_FEATURES[key];
      return [key, feature === undefined || features[feature] === true ? filter : FILTERS.all];
    }),
  );
}
