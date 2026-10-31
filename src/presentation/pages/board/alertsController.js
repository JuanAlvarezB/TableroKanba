// Alertas del tablero con la página abierta: contadores de las columnas, el resumen y el aviso de
// recordatorio, el botón "ver" que lleva a las tareas, y la revisión periódica (cada 15 s y al volver a
// la pestaña) por si una tarea superó el límite o cambió el día. Parte de la vista del tablero
// (BoardPage.js); el aviso lo dibuja components/OverdueAlerts.js.
import { filtersFor } from '../../../domain/rules/board.js';
import { stalledDays } from '../../../domain/rules/stalledTasks.js';
import { checkReminder } from '../../../domain/usecases/CheckReminder.js';
import { attentionGroups, createReminderBanner, renderColumnChips } from '../../components/OverdueAlerts.js';
import { dueInfo } from '../../format/dates.js';
import { currentFeatures } from '../../state/features.js';

const REFRESH_INTERVAL = 15000;

// Firma de las alertas que se ven: si cambia (pasa un día, una tarea supera el límite) hay que volver a
// dibujar el tablero.
export function overdueSignature(tasks) {
  return tasks.map((t) => `${t.id}:${stalledDays(t)}:${dueInfo(t)?.text}`).join('|');
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../../state/boardStore.js').createBoardStore>} deps.store
 * @param {ReturnType<typeof import('../../../data/repositories/ReminderStore.js').createReminderStore>} deps.reminders
 * @param {ReturnType<typeof import('./highlights.js').createHighlights>} deps.highlights
 * @param {() => void} deps.render
 * @param {() => boolean} deps.isDragging No se redibuja mientras se arrastra una tarjeta.
 * @param {{ current: () => string, showAll: () => void }} deps.filter Filtro activo y cómo quitarlo.
 */
export function createAlertsController({ store, reminders, highlights, render, isDragging, filter }) {
  const tasks = () => store.tasks;
  let lastSignature = '';

  const banner = createReminderBanner(
    {
      banner: document.getElementById('overdue-banner'),
      title: document.getElementById('overdue-title'),
      summary: document.getElementById('overdue-summary'),
      dismiss: document.getElementById('overdue-dismiss'),
    },
    { onShowTasks: showTasks },
  );

  // Muestra el recordatorio si toca turno, no se ha mostrado aún y hay tareas que lo necesitan.
  // Espera a que la pestaña esté visible para que el minuto en pantalla no pase sin verse.
  function showReminderIfDue() {
    if (document.visibilityState !== 'visible') return;
    const slot = checkReminder(tasks(), { lastShownId: reminders.lastShown(), features: currentFeatures() });
    if (!slot) return;
    reminders.markShown(slot.id);
    banner.show(slot);
  }

  // Lleva a las tareas indicadas y las resalta; si el filtro las oculta, se muestran todas.
  function showTasks(ids) {
    if (ids.length === 0) return;
    highlights.highlight(ids);
    const visible = tasks()
      .filter((t) => ids.includes(t.id))
      .every(filtersFor(currentFeatures())[filter.current()]);
    if (visible) render();
    else filter.showAll();
    const card = document.querySelector(`.card[data-id="${CSS.escape(ids[0])}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Revisa con la página abierta si alguna tarea superó el límite, si cambió el día o si
  // empezó un turno de recordatorio. No se redibuja mientras se arrastra una tarjeta.
  function refresh() {
    if (!isDragging() && overdueSignature(tasks()) !== lastSignature) render();
    showReminderIfDue();
  }

  return {
    // Parte de render(): contadores, resumen y, si toca, el recordatorio.
    render() {
      lastSignature = overdueSignature(tasks());
      renderColumnChips(tasks());
      const groups = attentionGroups(tasks());
      banner.renderSummary(groups);
      // Si mientras se muestra se resuelve todo lo pendiente, el aviso sobra.
      if (groups.length === 0) banner.hide();
      else showReminderIfDue();
    },

    listen() {
      setInterval(refresh, REFRESH_INTERVAL);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
      });
    },
  };
}
