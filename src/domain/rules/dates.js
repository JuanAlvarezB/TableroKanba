// Cálculos de días en la hora local, compartidos por los vencimientos y las tareas detenidas.

const DAY_MS = 86400000;

// Días calendario entre la fecha y hoy (de medianoche a medianoche, en la hora local).
export function calendarDaysSince(ms, now = new Date()) {
  const start = new Date(ms);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // Se redondea porque los cambios de horario hacen que un día dure 23 o 25 horas.
  return Math.round((today - start) / DAY_MS);
}

// Días hábiles (lunes a viernes) desde mañana hasta la fecha, ambos incluidos. Se deja de
// contar al superar `limit` porque solo importa saber si se supera.
export function businessDaysUntil(date, limit, now = new Date()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  let count = 0;
  while (day < date && count <= limit) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0 && day.getDay() !== 6) count += 1;
  }
  return count;
}
