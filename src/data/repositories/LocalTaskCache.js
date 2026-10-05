// Copia de las tareas en localStorage: el tablero se muestra al instante y sigue funcionando
// sin conexión. Las claves llevan el ambiente y el uid (ver auth.js), así nadie ve la copia
// de otra persona en el mismo navegador.
import { isStoredTask, taskFromStorage } from '../../domain/entities/Task.js';
import { readStorage, writeStorage } from '../datasources/browserStorage.js';

/**
 * @param {{ tasksKey: string, migratedKey: string }} keys
 */
export function createLocalTaskCache({ tasksKey, migratedKey }) {
  return {
    // Clave de las tareas, para reconocer los cambios de otras pestañas (evento storage).
    tasksKey,

    // Datos corruptos o sin localStorage: se empieza con el tablero vacío. Migra los formatos
    // anteriores (ver taskFromStorage). No ordena: eso lo decide quien la usa.
    load() {
      let parsed;
      try {
        parsed = JSON.parse(readStorage(tasksKey) || '[]');
      } catch {
        parsed = [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isStoredTask).map(taskFromStorage);
    },

    // Devuelve false si el navegador no permitió guardar.
    save(tasks) {
      return writeStorage(tasksKey, JSON.stringify(tasks));
    },

    // Si las tareas guardadas solo en este navegador ya se subieron a Firestore. Sin
    // localStorage no hay forma de saberlo, así que se responde true para no subirlas.
    isMigrated() {
      try {
        return Boolean(localStorage.getItem(migratedKey));
      } catch {
        return true;
      }
    },

    // Sin almacenamiento no hay forma de recordar la migración; no pasa nada si se repite.
    markMigrated() {
      writeStorage(migratedKey, '1');
    },
  };
}
