// Último turno de recordatorio mostrado en este navegador, para no repetirlo al recargar o en
// otra pestaña. Guarda también una copia en memoria por si el navegador no permite localStorage.
import { readStorage, writeStorage } from '../datasources/browserStorage.js';

const REMINDER_KEY = 'ultimo-recordatorio';

export function createReminderStore() {
  let lastShown = null;
  return {
    lastShown() {
      return readStorage(REMINDER_KEY) ?? lastShown;
    },
    markShown(id) {
      lastShown = id;
      writeStorage(REMINDER_KEY, id);
    },
  };
}
