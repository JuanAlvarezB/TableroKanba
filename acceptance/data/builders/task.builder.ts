import { randomUUID } from 'node:crypto';

export type TaskStatus = 'pending' | 'in-progress' | 'completed';

export interface Subtask {
  id: string;
  text: string;
  // DEVIATION: field name of the app's Firestore documents (Task.js), so it cannot take the is- prefix.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  done: boolean;
}

export interface SeededTask {
  id: string;
  text: string;
  status: TaskStatus;
  order: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  dueDate: string | null;
  subtasks: Subtask[];
}

export function buildSubtask(text: string, isDone = false): Subtask {
  return { id: `subtask-${randomUUID()}`, text, done: isDone };
}

// A valid task as the app stores it (dates in milliseconds); in-progress tasks get a start date.
export function buildTask(overrides: Partial<SeededTask> = {}): SeededTask {
  const createdAt = overrides.createdAt ?? Date.now();
  const status = overrides.status ?? 'pending';
  return {
    id: `task-${randomUUID()}`,
    text: `Tarea ${randomUUID().slice(0, 8)}`,
    status,
    order: 0,
    createdAt,
    startedAt: status === 'pending' ? null : createdAt,
    completedAt: null,
    dueDate: null,
    subtasks: [],
    ...overrides,
  };
}
