import { describe, expect, it } from 'vitest';
import {
  createTask,
  datesForStatus,
  isStoredTask,
  missingDates,
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
  it('crea la tarea en Pendiente, sin etiquetas y con fecha de creación', () => {
    expect(createTask({ id: 'n', text: 'Nueva', order: 4, now: NOW })).toEqual({
      id: 'n',
      text: 'Nueva',
      status: 'pending',
      order: 4,
      createdAt: NOW,
      startedAt: null,
      completedAt: null,
      priority: null,
      dueDate: null,
    });
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
