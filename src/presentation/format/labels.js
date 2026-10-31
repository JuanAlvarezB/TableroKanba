// Textos de la interfaz para los datos del dominio (estados, prioridades, columnas).

export const STATUS_LABELS = { pending: 'Creada', 'in-progress': 'En curso', completed: 'Completada' };

// En una tarea devuelta a Pendiente, createdAt es la fecha del regreso, no la de creación (B-4.1).
export const PENDING_SINCE_LABEL = 'En Pendiente desde';

// Nombre de cada columna en los eventos del historial ("Movida de Pendiente a En curso").
export const COLUMN_NAMES = { pending: 'Pendiente', 'in-progress': 'En curso', completed: 'Completada' };

// Etiquetas de prioridad, en el orden de PRIORITY_LEVELS (domain/entities/Task.js).
export const PRIORITIES = {
  urgent: { icon: '🔴', label: 'Urgente' },
  high: { icon: '⬆', label: 'Prioritaria' },
  low: { icon: '💤', label: 'Puede esperar' },
};

// Nombre del botón 🏷️ y de su menú según las funciones activas (docs/PLAN_USUARIOS.md, 3.4).
export const LABEL_MENU_NAMES = {
  both: 'Etiqueta y fecha límite',
  priorities: 'Etiqueta de prioridad',
  dueDates: 'Fecha límite',
};

// Textos de las alertas de tareas detenidas (la regla está en domain/rules/stalledTasks.js).
// "phrase" completa frases como "Lleva 4 días en Pendiente".
export const OVERDUE_COLUMNS = {
  pending: { name: 'Pendiente', phrase: 'en Pendiente' },
  'in-progress': { name: 'En curso', phrase: 'en curso' },
};

// Historial completo de la tarjeta (docs/PLAN_USUARIOS.md, 4.6). Los textos de cada evento, que
// llevan fechas, están en format/dates.js.
export const HISTORY_TEXTS = {
  toggle: (count) => `Ver historial (${count})`,
  listLabel: 'Historial completo, del cambio más reciente al más antiguo',
  derived: '(según las fechas guardadas)',
  noPriority: 'sin etiqueta',
  noDueDate: 'sin fecha',
};

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
