// Pruebas de la lógica propia de los controladores del tablero (pages/board/), sin navegador.
import { describe, expect, it } from 'vitest';
import { editOutcome, editingConflict } from './editingController.js';
import { HIGHLIGHT_DURATION, createHighlights } from './highlights.js';

const task = (id, fields = {}) => ({ id, text: 'Texto', status: 'pending', ...fields });

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

describe('guardar la edición de una tarea', () => {
  it('guarda un texto distinto', () => {
    expect(editOutcome(task('a'), 'Otro texto')).toBe('save');
  });

  it('no hace nada si el texto no cambió o la tarea ya no existe', () => {
    expect(editOutcome(task('a'), 'Texto')).toBe('none');
    expect(editOutcome(undefined, 'Otro texto')).toBe('none');
    expect(editOutcome(undefined, '')).toBe('none');
  });

  it('avisa si quedó vacía', () => {
    expect(editOutcome(task('a'), '')).toBe('empty');
  });

  it('avisa si la tarea se completó, antes que si quedó vacía', () => {
    expect(editOutcome(task('a', { status: 'completed' }), 'Otro texto')).toBe('completed');
    expect(editOutcome(task('a', { status: 'completed' }), '')).toBe('completed');
  });
});

describe('tarea en edición cambiada en otro dispositivo', () => {
  it('sigue editándose si existe y no está completada', () => {
    expect(editingConflict([task('a'), task('b', { status: 'in-progress' })], 'b')).toBeNull();
  });

  it('se deja de editar si se borró o se completó', () => {
    expect(editingConflict([task('a')], 'b')).toBe('deleted');
    expect(editingConflict([task('a', { status: 'completed' })], 'a')).toBe('completed');
  });
});
