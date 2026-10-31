// Pruebas de la lógica propia de los controladores del tablero (pages/board/), sin navegador.
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_DURATION, createHighlights } from './highlights.js';

describe('resaltado de tarjetas', () => {
  function withClock() {
    let time = 1000;
    const highlights = createHighlights({ now: () => time });
    return { highlights, advance: (ms) => (time += ms) };
  }

  it('una tarjeta sin resaltar no tiene tiempo transcurrido', () => {
    expect(withClock().highlights.elapsed('a')).toBeNull();
  });

  it('cuenta el tiempo desde que empezó, aunque se pregunte varias veces', () => {
    const { highlights, advance } = withClock();
    highlights.highlight(['a', 'b']);
    advance(400);
    expect(highlights.elapsed('a')).toBe(400);
    expect(highlights.elapsed('b')).toBe(400);
    advance(100);
    expect(highlights.elapsed('a')).toBe(500);
  });

  it('volver a resaltar reinicia la cuenta', () => {
    const { highlights, advance } = withClock();
    highlights.highlight(['a']);
    advance(1000);
    highlights.highlight(['a']);
    expect(highlights.elapsed('a')).toBe(0);
  });

  it('al terminar la animación deja de estar resaltada', () => {
    const { highlights, advance } = withClock();
    highlights.highlight(['a']);
    advance(HIGHLIGHT_DURATION);
    expect(highlights.elapsed('a')).toBeNull();
    advance(-1);
    expect(highlights.elapsed('a')).toBeNull();
  });
});
