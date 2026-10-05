// Estado del tablero: las tareas de la persona y su sincronización. Aplica los casos de uso del
// dominio, guarda en la copia local (LocalTaskCache) y en Firestore (TaskRepository), y avisa a
// la vista con eventos. No toca el DOM: la vista (pages/board/BoardPage.js) se suscribe.
//
// Eventos:
//   change     → el tablero cambió y hay que volver a dibujarlo.
//   notice     → mensaje para la persona (texto).
//   highlight  → ids de tarjetas que hay que resaltar.
//   added      → tareas nuevas que hay que anunciar.
//   edited     → tareas cuyo texto cambió en otro dispositivo.
//   sync       → estado de la conexión: 'connecting' | 'online' | 'offline'.
import { missingDates } from '../../domain/entities/Task.js';
import { sortTasks } from '../../domain/rules/board.js';
import { addTask } from '../../domain/usecases/AddTask.js';
import { clearCompleted, deleteTask } from '../../domain/usecases/DeleteTasks.js';
import { migrateLocalTasks } from '../../domain/usecases/MigrateLocalTasks.js';
import { moveTask } from '../../domain/usecases/MoveTask.js';
import { setDueDate } from '../../domain/usecases/SetDueDate.js';
import { setPriority } from '../../domain/usecases/SetPriority.js';

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * El tablero empieza vacío y sin copia local: se abre con loadLocal() al confirmar la sesión.
 * @param {{ newId?: () => string }} [deps]
 */
export function createBoardStore({ newId = createId } = {}) {
  /** @type {import('../../domain/entities/Task.js').Task[]} */
  let tasks = [];
  /** @type {ReturnType<typeof import('../../data/repositories/LocalTaskCache.js').createLocalTaskCache> | null} */
  let cache = null;
  /** @type {import('../../domain/repositories/TaskRepository.js').TaskRepository | null} */
  let repository = null;
  let stopListening = null;
  let syncState = null;

  const listeners = new Map();
  function emit(type, payload) {
    (listeners.get(type) ?? []).forEach((listener) => listener(payload));
  }

  // Se intenta completar las fechas una sola vez por tarea: si el servidor rechaza la
  // escritura, Firestore la deshace y volvería a llegar la tarea sin fechas, lo que
  // provocaría reintentos sin fin.
  const backfilledIds = new Set();

  /* ---------- Guardar ---------- */

  function saveLocal() {
    if (!cache) return;
    if (!cache.save(tasks)) emit('notice', 'No se pudieron guardar los cambios en este navegador.');
  }

  function setSync(state) {
    syncState = state;
    emit('sync', state);
  }

  function handleSyncError(error) {
    console.error('Error de sincronización con Firestore:', error.cause ?? error);

    // La conexión funciona pero las reglas de seguridad rechazaron el cambio; Firestore lo
    // deshace solo y el tablero vuelve a mostrar lo que hay en el servidor.
    if (error.reason === 'permission-denied' && repository) {
      emit(
        'notice',
        'El servidor rechazó el cambio (reglas de seguridad de Firestore). Revisa la consola para más detalle.',
      );
      return;
    }

    if (syncState !== 'offline') {
      emit('notice', 'No se pudo conectar con el servidor: los cambios solo se guardan en este dispositivo.');
    }
    setSync('offline');
  }

  function saveRemote(task) {
    if (repository) repository.save(task).catch(handleSyncError);
  }

  function updateRemote(id, fields) {
    if (repository) repository.update(id, fields).catch(handleSyncError);
  }

  function deleteRemote(ids) {
    if (repository && ids.length > 0) repository.remove(ids).catch(handleSyncError);
  }

  // Completa las fechas que falten y las sincroniza; solo se escriben los campos ausentes,
  // así no se pisan las fechas que otro dispositivo haya guardado.
  function backfillDates() {
    const pending = tasks
      .filter((task) => !backfilledIds.has(task.id))
      .map((task) => [task, missingDates(task)])
      .filter(([, fields]) => Object.keys(fields).length > 0);
    if (pending.length === 0) return;

    pending.forEach(([task, fields]) => {
      if (repository) backfilledIds.add(task.id);
      Object.assign(task, fields);
      updateRemote(task.id, fields);
    });
    saveLocal();
  }

  // Compara el tablero anterior con el actual: resalta las tarjetas que cambiaron de texto,
  // columna o etiqueta en otro dispositivo y avisa de las ediciones de texto.
  function notifyRemoteChanges(previousTasks) {
    const previous = new Map(previousTasks.map((t) => [t.id, t]));
    const changed = tasks.filter((t) => {
      const before = previous.get(t.id);
      return before && ['text', 'status', 'priority', 'dueDate'].some((field) => before[field] !== t[field]);
    });
    emit(
      'highlight',
      changed.map((t) => t.id),
    );
    const edited = changed.filter((t) => previous.get(t.id).text !== t.text);
    if (edited.length > 0) emit('edited', edited);
  }

  /* ---------- Acciones ---------- */

  // Cambia solo los campos indicados, así no pisa lo que otro dispositivo cambie a la vez.
  function updateTask(id, fields) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return false;
    Object.assign(task, fields);
    saveLocal();
    updateRemote(id, fields);
    return true;
  }

  return {
    get tasks() {
      return tasks;
    },

    get connected() {
      return repository !== null;
    },

    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },

    // Abre la copia local de la persona (el tablero se ve al instante, también sin conexión).
    loadLocal(localCache) {
      cache = localCache;
      tasks = sortTasks(cache.load());
      backfillDates();
      emit('change');
    },

    add(text) {
      const result = addTask(tasks, { id: newId(), text });
      tasks = result.tasks;
      saveLocal();
      saveRemote(result.task);
      emit('change');
      emit('added', [result.task]);
    },

    // Mueve una tarea a otra columna; si se indica beforeId, la coloca antes de esa tarea.
    move(id, status, beforeId = null) {
      const result = moveTask(tasks, { id, status, beforeId });
      if (!result.ok) {
        if (result.reason === 'wip-limit') {
          emit(
            'notice',
            `Límite WIP alcanzado: termina una tarea "En curso" antes de empezar otra (máx. ${result.limit}).`,
          );
        }
        return;
      }
      tasks = result.tasks;
      saveLocal();
      updateRemote(id, result.changes);
      emit('change');
    },

    // Cambia el texto (la vista valida antes que no esté vacío ni completada).
    editText(id, text) {
      if (updateTask(id, { text })) emit('highlight', [id]);
      emit('change');
    },

    // Al cambiar la etiqueta, la tarea pasa al final de su nuevo grupo.
    setPriority(id, priority) {
      const changes = setPriority(tasks, { id, priority });
      if (!changes) return;
      updateTask(id, changes);
      sortTasks(tasks);
      emit('highlight', [id]);
      emit('change');
    },

    setDueDate(id, dueDate) {
      const changes = setDueDate(tasks, { id, dueDate });
      if (!changes) return;
      updateTask(id, changes);
      emit('change');
    },

    delete(id) {
      const result = deleteTask(tasks, { id });
      tasks = result.tasks;
      saveLocal();
      deleteRemote(result.removedIds);
      emit('change');
    },

    clearCompleted() {
      const result = clearCompleted(tasks);
      tasks = result.tasks;
      saveLocal();
      deleteRemote(result.removedIds);
      emit('change');
    },

    /* ---------- Sincronización ---------- */

    // Conecta con Firestore y escucha los cambios de cualquier dispositivo. Sin conexión,
    // Firestore sigue reintentando y el tablero funciona con la copia local mientras tanto.
    // Antes sube, una sola vez, las tareas que solo estaban en este navegador.
    connect(taskRepository, { offline = false } = {}) {
      setSync(offline ? 'offline' : 'connecting');
      repository = taskRepository;
      migrateLocalTasks({ tasks, cache, repository }).catch(handleSyncError);

      let firstSnapshot = true;
      stopListening = repository.subscribe((snapshot) => {
        // Hasta recibir datos del servidor, la caché de Firestore está vacía o incompleta: si
        // se aplicara, borraría del tablero la copia local. Mientras tanto manda la copia local.
        if (firstSnapshot && snapshot.fromCache) return;

        const previousTasks = tasks;
        tasks = sortTasks(snapshot.tasks);
        backfillDates();
        saveLocal();
        // Los cambios propios ya están en previousTasks, así que solo se detectan los ajenos.
        if (!firstSnapshot) notifyRemoteChanges(previousTasks);
        emit('change');
        setSync(snapshot.fromCache ? 'offline' : 'online');

        // Las tareas creadas en este navegador ya se anunciaron al crearlas.
        if (!firstSnapshot && snapshot.added.length > 0) emit('added', snapshot.added);
        firstSnapshot = false;
      }, handleSyncError);
    },

    // Al cerrar la sesión se deja de escuchar y de escribir antes de borrar la copia local.
    disconnect() {
      stopListening?.();
      stopListening = null;
      repository = null;
      cache = null;
    },

    // Sin conexión a Firestore, sincroniza al menos las pestañas del mismo navegador: otra
    // pestaña cambió la copia local (key es null cuando vacía todo el localStorage).
    reloadFromStorage(key) {
      if (!cache || repository || (key !== null && key !== cache.tasksKey)) return;
      const previousTasks = tasks;
      const knownIds = new Set(tasks.map((t) => t.id));
      tasks = sortTasks(cache.load());
      notifyRemoteChanges(previousTasks);
      emit('change');
      const newTasks = tasks.filter((t) => !knownIds.has(t.id));
      if (newTasks.length > 0) emit('added', newTasks);
    },
  };
}
