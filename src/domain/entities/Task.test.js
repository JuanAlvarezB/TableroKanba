import { describe, expect, it } from 'vitest';
import {
  createTask,
  datesForStatus,
  isStoredTask,
  missingDates,
  readHistory,
  readSubtasks,
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
      subtasks: [],
      openSubtasks: 0,
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
      subtasks: [],
      openSubtasks: 0,
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
      { ...move, type: '' },
      { ...move, type: 7 },
      { ...move, id: '' },
      { ...move, id: 7 },
      { ...move, at: 'ayer' },
      { ...move, to: 'archived' },
      { ...move, to: null },
      { id: 'e', type: 'create', at: NOW },
      { id: 'e', type: 'edit', at: NOW, from: 'a', to: 5 },
      { id: 'e', type: 'priority', at: NOW, from: null, to: 'máxima' },
      { id: 'e', type: 'due', at: NOW, from: null, to: '15/10/2026' },
      { id: 'e', type: 'subtask', at: NOW, text: 'Paso', to: 'archivada' },
      { id: 'e', type: 'subtask', at: NOW, to: 'done' },
    ];
    expect(readHistory({ history: [...broken, move] })).toEqual([move]);
  });

  it('lee los eventos de subtareas', () => {
    const done = { id: 'e5', type: 'subtask', at: NOW, text: 'Paso 1', to: 'done' };
    const reopened = { id: 'e6', type: 'subtask', at: NOW, text: 'Paso 1', to: 'pending' };
    expect(readHistory({ history: [done, reopened] })).toEqual([done, reopened]);
  });

  it('conserva los tipos que no conoce, con solo sus campos simples (P-12)', () => {
    const future = {
      id: 'f1',
      type: 'expire',
      at: NOW,
      when: 1_800_000_000_000,
      note: 'Vence',
      automatic: true,
      by: null,
      nested: { a: 1 },
      list: [1],
      long: 'x'.repeat(201),
    };
    expect(readHistory({ history: [future, { ...move, type: 'constructor' }] })).toEqual([
      { id: 'f1', type: 'expire', at: NOW, when: 1_800_000_000_000, note: 'Vence', automatic: true, by: null },
      { ...move, type: 'constructor' },
    ]);
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

describe('readSubtasks', () => {
  const step = (id, done = false, text = `Paso ${id}`) => ({ id, text, done });

  it('sin el campo, o si no es una lista, no hay subtareas', () => {
    expect(readSubtasks({})).toEqual({ subtasks: [], openSubtasks: 0 });
    expect(readSubtasks({ subtasks: { s1: step('s1') } })).toEqual({ subtasks: [], openSubtasks: 0 });
    expect(readSubtasks({ subtasks: 'texto' })).toEqual({ subtasks: [], openSubtasks: 0 });
  });

  it('conserva el orden y cuenta las pendientes', () => {
    const list = [step('s1', true), step('s2'), step('s3')];
    expect(readSubtasks({ subtasks: list })).toEqual({ subtasks: list, openSubtasks: 2 });
  });

  it('recalcula el contador desde la lista, aunque el guardado diga otra cosa (AT-10)', () => {
    expect(readSubtasks({ subtasks: [step('s1'), step('s2', true)], openSubtasks: 0 }).openSubtasks).toBe(1);
    expect(readSubtasks({ subtasks: [step('s1', true)], openSubtasks: 5 }).openSubtasks).toBe(0);
  });

  it('descarta las mal formadas o repetidas, y los campos extra', () => {
    const list = [
      null,
      'texto',
      { id: '', text: 'x', done: false },
      { id: 7, text: 'x', done: false },
      { id: 's1', text: '', done: false },
      { id: 's1', text: '   ', done: false },
      { id: 's1', text: 5, done: false },
      { id: 's1', text: 'x', done: 'sí' },
      { ...step('s2'), priority: 'urgent' },
      step('s2', true),
    ];
    expect(readSubtasks({ subtasks: list }).subtasks).toEqual([step('s2')]);
  });

  it('se queda con las 20 primeras y recorta los textos a 200 caracteres sin partir emojis', () => {
    const many = Array.from({ length: 25 }, (_, i) => step(`s${i}`));
    expect(readSubtasks({ subtasks: many }).subtasks.map((s) => s.id)).toEqual(many.slice(0, 20).map((s) => s.id));
    const [long] = readSubtasks({ subtasks: [step('s1', false, '🌻'.repeat(250))] }).subtasks;
    expect(long.text).toBe('🌻'.repeat(200));
  });

  it('taskFromData, taskFromStorage y createTask incluyen las subtareas', () => {
    const list = [step('s1'), step('s2', true)];
    expect(taskFromData('id', { text: 'x', subtasks: list })).toMatchObject({ subtasks: list, openSubtasks: 1 });
    expect(taskFromStorage({ id: 'x', text: 'x', subtasks: list }, 0)).toMatchObject({
      subtasks: list,
      openSubtasks: 1,
    });
    expect(taskFromData('id', { text: 'x' })).toMatchObject({ subtasks: [], openSubtasks: 0 });
    expect(createTask({ id: 'n', text: 'Nueva', order: 0, now: NOW })).toMatchObject({ subtasks: [], openSubtasks: 0 });
  });
});
