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

// Nombre y descripción de cada función del catálogo (domain/rules/features.js) en el panel de permisos
// (docs/PLAN_USUARIOS.md, 3.7).
export const FEATURE_LABELS = {
  board: { name: 'Tablero de tareas', description: 'Ver y organizar sus tareas en tres columnas.' },
  priorities: {
    name: 'Etiquetas de prioridad',
    description: 'Urgente, Prioritaria y Puede esperar, con sus filtros.',
  },
  dueDates: { name: 'Fecha límite y vencimientos', description: 'Fechas límite, avisos de vencimiento y su filtro.' },
  stalledAlerts: {
    name: 'Alertas de tareas detenidas',
    description: 'Aviso cuando una tarea lleva más de 3 días sin moverse.',
  },
  reminders: { name: 'Recordatorios', description: 'Aviso de lunes a viernes a las 10:00 y a las 15:00.' },
  history: {
    name: 'Historial de la tarea',
    description: 'Línea de tiempo de cada tarea. Se sigue registrando aunque esté apagado.',
  },
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

// Largo con el que los diálogos nombran una tarea (docs/PLAN_SUBTAREAS.md, 1.2).
export const CLIP_LENGTH = 80;

// Recorta un texto largo con … al final. Cuenta caracteres, no unidades UTF-16, para no partir un emoji.
export function clipText(text, max = CLIP_LENGTH) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}
