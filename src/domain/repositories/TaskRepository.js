// Contrato del almacén de tareas. El dominio solo conoce esta forma; la capa de datos
// (src/data/repositories, fase 4) la implementa con Firestore. JavaScript no tiene interfaces,
// así que el contrato se documenta con JSDoc.

/**
 * @typedef {import('../entities/Task.js').Task} Task
 *
 * @typedef {object} TaskSnapshot
 * @property {Task[]} tasks Todas las tareas de la persona.
 * @property {Task[]} added Tareas creadas en otro dispositivo desde el snapshot anterior.
 * @property {boolean} fromCache true si los datos aún no están confirmados por el servidor.
 *
 * @typedef {object} TaskRepository
 * @property {(task: Task) => Promise<void>} save Crea o reemplaza una tarea.
 * @property {(id: string, fields: Partial<Task>) => Promise<void>} update Cambia solo esos campos
 *   (así no pisa lo que otro dispositivo cambie a la vez).
 * @property {(ids: string[]) => Promise<void>} remove Borra varias tareas a la vez.
 * @property {(tasks: Task[]) => Promise<void>} saveAll Sube varias tareas a la vez (migración).
 * @property {(onChange: (snapshot: TaskSnapshot) => void, onError: (error: Error) => void) => () => void} subscribe
 *   Escucha los cambios de cualquier dispositivo; devuelve la función para dejar de escuchar.
 */

export {};
