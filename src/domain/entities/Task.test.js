import { describe, expect, it } from 'vitest';
import {
  createTask,
  datesForStatus,
  isStoredTask,
  missingDates,
  readHistory,
  taskFromData,
  taskFromStorage,
  wasInProgress,
} from './Task.js';

const NOW = 1_790_000_000_000;

describe('taskFromStorage', () => {
  it('migra el formato antiguo ({ completed: boolean }, id numérico, sin orden)', () => {
    expect(taskFromStorage({ id: 5, text: 'Vieja', completed: true }, 3)).toEqual({
      id: '5',
      text: 'Vieja',
      status: 'completed',
      order: 3,
      createdAt: null,
      startedAt: null,
      completedAt: null,
      priority: null,
      dueDate: null,
      history: null,
    });
  });

  it('isStoredTask descarta lo que no es una tarea', () => {
    expect(isStoredTask(null)).toBe(false);
    expect(isStoredTask({ id: 1 })).toBe(false);
    expect(isStoredTask({ id: 1, text: '' })).toBe(true);
  });

  it('ignora etiquetas y fechas no válidas', () => {
    const task = taskFromStorage(
      { id: 'x', text: 't', status: 'raro', priority: 'máxima', dueDate: '15/10/2026', createdAt: 'ayer' },
      0,
    );
    expect(task).toMatchObject({ status: 'pending', priority: null, dueDate: null, createdAt: null });
  });
});

describe('taskFromData', () => {
  it('lee un documento de Firestore', () => {
    expect(
      taskFromData('id1', { text: 'Hola', status: 'in-progress', order: 2, startedAt: NOW, priority: 'high' }),
    ).toMatchObject({ id: 'id1', text: 'Hola', status: 'in-progress', order: 2, startedAt: NOW, priority: 'high' });
  });

  it('usa valores por defecto si faltan campos', () => {
    expect(taskFromData('id2', {})).toMatchObject({ text: '', status: 'pending', order: 0, priority: null });
  });
});

describe('createTask', () => {
  it('crea la tarea en Pendiente, sin etiquetas, con fecha de creación y su evento create', () => {
    const created = { id: 'e1', type: 'create', at: NOW, text: 'Nueva' };
    expect(createTask({ id: 'n', text: 'Nueva', order: 4, now: NOW, history: [created] })).toEqual({
      id: 'n',
      text: 'Nueva',
      status: 'pending',
      order: 4,
      createdAt: NOW,
      startedAt: null,
      completedAt: null,
      priority: null,
      dueDate: null,
      history: [created],
    });
  });
});

describe('readHistory', () => {
  const move = { id: 'e2', type: 'move', at: NOW, from: 'pending', to: 'in-progress' };

  it('sin el campo, o si no es una lista, devuelve null (tarea anterior al historial)', () => {
    expect(readHistory({})).toBeNull();
    expect(readHistory({ history: { 0: move } })).toBeNull();
    expect(readHistory({ history: 'texto' })).toBeNull();
  });

  it('conserva los eventos válidos de cada tipo, con solo sus campos', () => {
    const events = [
      { id: 'e1', type: 'create', at: NOW, text: 'Hola' },
      { id: 'e2', type: 'edit', at: NOW, from: 'Hola', to: 'Adiós' },
      { id: 'd:pending:1', type: 'move', at: 1, from: null, to: 'pending', derived: true },
      { id: 'e3', type: 'priority', at: NOW, from: null, to: 'urgent' },
      { id: 'e4', type: 'due', at: NOW, from: '2026-10-15', to: null },
    ];
    expect(readHistory({ history: [...events, { ...move, extra: 'x', derived: 'sí' }] })).toEqual([...events, move]);
  });

  it('descarta los eventos mal formados', () => {
    const broken = [
      null,
      'texto',
      { ...move, type: 'delete' },
      { ...move, type: 'constructor' },
      { ...move, id: '' },
      { ...move, id: 7 },
      { ...move, at: 'ayer' },
      { ...move, to: 'archived' },
      { ...move, to: null },
      { id: 'e', type: 'create', at: NOW },
      { id: 'e', type: 'edit', at: NOW, from: 'a', to: 5 },
      { id: 'e', type: 'priority', at: NOW, from: null, to: 'máxima' },
      { id: 'e', type: 'due', at: NOW, from: null, to: '15/10/2026' },
    ];
    expect(readHistory({ history: [...broken, move] })).toEqual([move]);
  });

  it('se queda con los 100 eventos más recientes', () => {
    const many = Array.from({ length: 105 }, (_, i) => ({ ...move, id: `e${i}`, at: i }));
    const history = readHistory({ history: many });
    expect(history).toHaveLength(100);
    expect(history[0].id).toBe('e5');
    expect(history.at(-1).id).toBe('e104');
  });

  it('taskFromData y taskFromStorage leen el historial', () => {
    expect(taskFromData('id', { text: 'x', history: [move, { basura: true }] }).history).toEqual([move]);
    expect(taskFromStorage({ id: 'x', text: 'x', history: [move] }, 0).history).toEqual([move]);
    expect(taskFromData('id', { text: 'x' }).history).toBeNull();
  });
});

describe('datesForStatus', () => {
  it('al avanzar registra la fecha del nuevo estado y borra las posteriores', () => {
    expect(datesForStatus('in-progress', NOW)).toEqual({ startedAt: NOW, completedAt: null });
    expect(datesForStatus('completed', NOW)).toEqual({ completedAt: NOW });
  });

  it('al volver a Pendiente conserva la fecha de En curso', () => {
    expect(datesForStatus('pending', NOW)).toEqual({ createdAt: NOW, completedAt: null });
  });
});

describe('wasInProgress y missingDates', () => {
  it('detecta una tarea devuelta desde En curso', () => {
    expect(wasInProgress({ status: 'pending', startedAt: NOW })).toBe(true);
    expect(wasInProgress({ status: 'pending', startedAt: null })).toBe(false);
    expect(wasInProgress({ status: 'in-progress', startedAt: NOW })).toBe(false);
  });

  it('completa solo la fecha de creación y la del estado actual', () => {
    expect(missingDates({ status: 'in-progress', createdAt: null, startedAt: null }, NOW)).toEqual({
      createdAt: NOW,
      startedAt: NOW,
    });
    expect(missingDates({ status: 'pending', createdAt: 1 }, NOW)).toEqual({});
  });
});
