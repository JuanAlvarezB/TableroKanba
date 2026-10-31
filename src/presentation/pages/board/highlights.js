// Resaltado de las tarjetas que cambiaron: recuerda cuándo empezó cada uno (id → momento de inicio)
// para que no se reinicie aunque el tablero se vuelva a dibujar mientras dura la animación. Parte de
// la vista del tablero (BoardPage.js).

export const HIGHLIGHT_DURATION = 1600;

/**
 * @param {{ now?: () => number }} [clock] Reloj en ms (performance.now en el navegador).
 */
export function createHighlights({ now = () => performance.now() } = {}) {
  const highlights = new Map();

  return {
    highlight(ids) {
      const start = now();
      ids.forEach((id) => highlights.set(id, start));
    },

    // ms desde que empezó el resaltado de la tarjeta, o null si no tiene (o ya terminó).
    elapsed(id) {
      const start = highlights.get(id);
      if (start === undefined) return null;
      const elapsed = now() - start;
      if (elapsed < HIGHLIGHT_DURATION) return elapsed;
      highlights.delete(id);
      return null;
    },
  };
}
