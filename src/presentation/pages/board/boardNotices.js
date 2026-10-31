// Avisos del tablero: el aviso general (#board-notice), los anuncios de tareas nuevas o editadas en
// otro dispositivo (#toast) y el indicador de sincronización. Parte de la vista del tablero
// (BoardPage.js); no guarda estado propio salvo los temporizadores del flasher.
import { createFlasher } from '../../components/FlashMessage.js';

const SYNC_LABELS = {
  connecting: 'Conectando…',
  online: 'Sincronizado',
  offline: 'Solo en este dispositivo',
};

/**
 * @param {{ boardNotice: HTMLElement, toast: HTMLElement, syncStatus: HTMLElement }} elements
 */
export function createBoardNotices({ boardNotice, toast, syncStatus }) {
  const flash = createFlasher();

  return {
    showNotice(message) {
      flash(boardNotice, message);
    },

    announceNewTasks(newTasks) {
      flash(
        toast,
        newTasks.length === 1
          ? `Se agregó una nueva tarea: "${newTasks[0].text}"`
          : `Se agregaron ${newTasks.length} tareas nuevas`,
      );
    },

    announceEditedTasks(editedTasks) {
      flash(
        toast,
        editedTasks.length === 1
          ? `Se actualizó una tarea: "${editedTasks[0].text}"`
          : `Se actualizaron ${editedTasks.length} tareas`,
      );
    },

    setSyncStatus(state) {
      syncStatus.dataset.state = state;
      syncStatus.textContent = SYNC_LABELS[state];
    },
  };
}
