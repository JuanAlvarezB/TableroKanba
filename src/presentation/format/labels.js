// Textos de la interfaz para los datos del dominio (estados, prioridades, columnas).

export const STATUS_LABELS = { pending: 'Creada', 'in-progress': 'En curso', completed: 'Completada' };

// Etiquetas de prioridad, en el orden de PRIORITY_LEVELS (domain/entities/Task.js).
export const PRIORITIES = {
  urgent: { icon: '🔴', label: 'Urgente' },
  high: { icon: '⬆', label: 'Prioritaria' },
  low: { icon: '💤', label: 'Puede esperar' },
};

// Textos de las alertas de tareas detenidas (la regla está en domain/rules/stalledTasks.js).
// "phrase" completa frases como "Lleva 4 días en Pendiente".
export const OVERDUE_COLUMNS = {
  pending: { name: 'Pendiente', phrase: 'en Pendiente' },
  'in-progress': { name: 'En curso', phrase: 'en curso' },
};

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
