// Pruebas de la lógica propia de los controladores del tablero (pages/board/), sin navegador.
import { describe, expect, it } from 'vitest';
import { overdueSignature } from './alertsController.js';
import { cardAfterY } from './dragController.js';
import { editOutcome, editingConflict } from './editingController.js';
import { HIGHLIGHT_DURATION, createHighlights } from './highlights.js';

// Tarea con la forma de domain/entities/Task.js, creada ahora (sin alertas).
const task = (id, fields = {}) => ({
  id,
  text: 'Texto',
  status: 'pending',
  order: 0,
  createdAt: Date.now(),
  startedAt: null,
  completedAt: null,
  priority: null,
  dueDate: null,
  history: null,
  ...fields,
});

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

describe('firma de las alertas', () => {
  it('es la misma con las mismas tareas y cambia si cambia el tablero', () => {
    const board = [task('a'), task('b')];
    expect(overdueSignature(board)).toBe(overdueSignature([task('a'), task('b')]));
    expect(overdueSignature(board)).not.toBe(overdueSignature([task('a')]));
    expect(overdueSignature([])).toBe('');
  });
});

describe('tarjeta bajo el cursor al soltar', () => {
  // Tarjetas de 100 px de alto, una debajo de otra desde y = 0.
  const column = (...priorities) =>
    priorities.map((priority, index) => ({
      card: `c${index}`,
      priority,
      box: () => ({ top: index * 100, height: 100 }),
    }));

  it('devuelve la primera tarjeta cuya mitad queda por debajo del cursor', () => {
    const cards = column('', '', '');
    expect(cardAfterY(cards, 10, null, false)).toBe('c0');
    expect(cardAfterY(cards, 49, null, false)).toBe('c0');
    expect(cardAfterY(cards, 50, null, false)).toBe('c1');
    expect(cardAfterY(cards, 249, null, false)).toBe('c2');
  });

  it('sin tarjeta debajo, la tarea va al final', () => {
    expect(cardAfterY(column('', ''), 150, null, false)).toBeUndefined();
    expect(cardAfterY([], 0, null, false)).toBeUndefined();
  });

  it('agrupada por etiqueta, solo cuenta las tarjetas de su grupo', () => {
    const cards = column('urgent', 'urgent', '', 'low');
    expect(cardAfterY(cards, 10, null, true)).toBe('c2');
    expect(cardAfterY(cards, 260, 'urgent', true)).toBeUndefined();
    expect(cardAfterY(cards, 10, 'low', true)).toBe('c3');
  });

  it('con priorities apagada sigue el orden manual, sin grupos', () => {
    const cards = column('urgent', '', 'low');
    expect(cardAfterY(cards, 10, 'low', false)).toBe('c0');
    expect(cardAfterY(cards, 160, null, false)).toBe('c2');
  });

  it('pide la caja solo de las tarjetas que revisa', () => {
    const asked = [];
    const cards = column('', '', '').map((entry) => ({ ...entry, box: () => (asked.push(entry.card), entry.box()) }));
    cardAfterY(cards, 10, null, false);
    expect(asked).toEqual(['c0']);
  });
});
