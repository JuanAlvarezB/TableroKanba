// Contrato del almacén de tareas. El dominio solo conoce esta forma; la capa de datos
// (src/data/repositories, fase 4) la implementa con Firestore. JavaScript no tiene interfaces,
// así que el contrato se documenta con JSDoc.

/**
 * @typedef {import('../entities/Task.js').Task} Task
 * @typedef {import('../rules/history.js').HistoryWrite} HistoryWrite
 *
 * @typedef {object} TaskSnapshot
 * @property {Task[]} tasks Todas las tareas de la persona.
 * @property {Task[]} added Tareas creadas en otro dispositivo desde el snapshot anterior.
 * @property {boolean} fromCache true si los datos aún no están confirmados por el servidor.
 * @property {string[]} drifted Tareas cuyo contador de subtareas guardado no coincide con su lista; se
 *   leen con el contador recalculado y el estado las repara (docs/PLAN_SUBTAREAS.md, P-13).
 *
 * @typedef {object} TaskRepository
 * Crear y borrar tareas escribe también su documento del índice (taskIndex: mismo ID, solo el
 * dueño) en el mismo lote; editar o mover no lo toca. Las escrituras de varias tareas se parten en
 * trozos de 8, que no son atómicos entre sí (docs/PLAN_USUARIOS.md, 2.6).
 *
 * @property {(task: Task) => Promise<void>} save Crea una tarea, con su historial y su índice.
 * @property {(id: string, fields: Partial<Task>, historyWrite?: HistoryWrite | null) => Promise<void>} update
 *   Cambia solo esos campos (así no pisa lo que otro dispositivo cambie a la vez; las subtareas van siempre
 *   enteras, con su contador, y ahí gana la última escritura: docs/PLAN_SUBTAREAS.md, 2.9) y, en la misma
 *   escritura, el historial según el plan de planHistoryWrite: append añade los eventos sin pisar los
 *   de otros dispositivos; replace reemplaza la lista entera (compactación).
 * @property {(ids: string[]) => Promise<void>} remove Borra varias tareas y sus índices, en trozos.
 * @property {(tasks: Task[]) => Promise<void>} saveAll Sube varias tareas con su historial y su
 *   índice, en trozos (migración).
 * @property {() => Promise<string[]>} indexedIds IDs del índice de la persona, leídos del servidor.
 * @property {(ids: string[]) => Promise<void>} addToIndex Crea el índice de tareas que ya existen.
 * @property {(ids: string[]) => Promise<void>} removeFromIndex Borra índices que no tienen tarea.
 * @property {(onChange: (snapshot: TaskSnapshot) => void, onError: (error: Error) => void) => () => void} subscribe
 *   Escucha los cambios de cualquier dispositivo; devuelve la función para dejar de escuchar.
 */

export {};
