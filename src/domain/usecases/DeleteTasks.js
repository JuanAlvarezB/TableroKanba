// Borrar una tarea, o todas las completadas.

export function deleteTask(tasks, { id }) {
  return { tasks: tasks.filter((t) => t.id !== id), removedIds: [id] };
}

export function clearCompleted(tasks) {
  return {
    tasks: tasks.filter((t) => t.status !== 'completed'),
    removedIds: tasks.filter((t) => t.status === 'completed').map((t) => t.id),
  };
}
