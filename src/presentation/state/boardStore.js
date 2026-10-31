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
//   access-lost → las reglas rechazaron una operación: quizá la persona fue desactivada, así que
//                la guardia revalida su acceso (presentation/guards/session.js).
//   blocked    → no se completó una tarea porque le faltan subtareas: { id, open, total, pending }
//                (docs/PLAN_SUBTAREAS.md, 2.5); la vista explica qué falta.
import { missingDates } from '../../domain/entities/Task.js';
import { sortTasks } from '../../domain/rules/board.js';
import { historyEventsFor, planHistoryWrite } from '../../domain/rules/history.js';
import { subtaskChanges } from '../../domain/rules/subtasks.js';
import { addSubtask } from '../../domain/usecases/AddSubtask.js';
import { addTask } from '../../domain/usecases/AddTask.js';
import { completeTaskIndex } from '../../domain/usecases/CompleteTaskIndex.js';
import { clearCompleted, deleteTask } from '../../domain/usecases/DeleteTasks.js';
import { editSubtask } from '../../domain/usecases/EditSubtask.js';
import { migrateLocalTasks } from '../../domain/usecases/MigrateLocalTasks.js';
import { moveTask } from '../../domain/usecases/MoveTask.js';
import { removeSubtask } from '../../domain/usecases/RemoveSubtask.js';
import { reorderSubtask } from '../../domain/usecases/ReorderSubtask.js';
import { setDueDate } from '../../domain/usecases/SetDueDate.js';
import { setPriority } from '../../domain/usecases/SetPriority.js';
import { toggleSubtask } from '../../domain/usecases/ToggleSubtask.js';
import { SAVED_WITHOUT_HISTORY } from '../../data/repositories/LocalTaskCache.js';
import { BOARD_MESSAGES } from '../../shared/constants/messages.js';
import { clipText } from '../format/labels.js';

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Identificador de un evento del historial: 8 caracteres aleatorios (el final de un id de tarea).
function createEventId() {
  return createId().replace(/-/g, '').slice(-8);
}

/**
 * El tablero empieza vacío y sin copia local: se abre con loadLocal() al confirmar la sesión.
 * @param {{ newId?: () => string, newEventId?: () => string, now?: () => number }} [deps]
 */
export function createBoardStore({ newId = createId, newEventId = createEventId, now = Date.now } = {}) {
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

  // Tareas cuyo contador de subtareas ya se intentó reparar en esta sesión (P-13), por el mismo motivo.
  const repairedIds = new Set();

  // Si la copia local solo cabe sin el historial se avisa una sola vez: el tablero funciona igual.
  let historyNoticeShown = false;

  /* ---------- Guardar ---------- */

  function saveLocal() {
    if (!cache) return;
    const saved = cache.save(tasks);
    if (!saved) emit('notice', 'No se pudieron guardar los cambios en este navegador.');
    if (saved === SAVED_WITHOUT_HISTORY && !historyNoticeShown) {
      historyNoticeShown = true;
      emit('notice', BOARD_MESSAGES.historyNotStored);
    }
  }

  function setSync(state) {
    syncState = state;
    emit('sync', state);
  }

  // rejectedNotice: aviso propio de esa escritura si las reglas la rechazan (por ejemplo, completar una
  // tarea que otro dispositivo dejó con subtareas pendientes); si no hay, el aviso general.
  function handleSyncError(error, rejectedNotice = null) {
    console.error('Error de sincronización con Firestore:', error.cause ?? error);

    // La conexión funciona pero las reglas de seguridad rechazaron el cambio; Firestore lo
    // deshace solo y el tablero vuelve a mostrar lo que hay en el servidor.
    if (error.reason === 'permission-denied' && repository) {
      emit(
        'notice',
        rejectedNotice ??
          'El servidor rechazó el cambio (reglas de seguridad de Firestore). Revisa la consola para más detalle.',
      );
      emit('access-lost');
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

  function updateRemote(id, fields, historyWrite = null, rejectedNotice = null) {
    if (repository)
      repository.update(id, fields, historyWrite).catch((error) => handleSyncError(error, rejectedNotice));
  }

  function deleteRemote(ids) {
    if (repository && ids.length > 0) repository.remove(ids).catch(handleSyncError);
  }

  // Completa las fechas que falten y las sincroniza; solo se escriben los campos ausentes,
  // así no se pisan las fechas que otro dispositivo haya guardado.
  function backfillDates() {
    const pending = tasks
      .filter((task) => !backfilledIds.has(task.id))
      .map((task) => [task, missingDates(task, now())])
      .filter(([, fields]) => Object.keys(fields).length > 0);
    if (pending.length === 0) return;

    pending.forEach(([task, fields]) => {
      if (repository) backfilledIds.add(task.id);
      Object.assign(task, fields);
      updateRemote(task.id, fields);
    });
    saveLocal();
  }

  // Repara una vez por sesión el contador de subtareas que no coincide con su lista (P-13), escribiendo
  // los dos desde la lista recién leída. Una tarea completada no se toca: no se mueve nada sin que la
  // persona lo pida. Es mantenimiento: si falla no se avisa y se reintenta en la siguiente sesión.
  function repairSubtaskCounters(ids) {
    if (!repository) return;
    ids.forEach((id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task || task.status === 'completed' || repairedIds.has(id)) return;
      repairedIds.add(id);
      repository
        .update(id, subtaskChanges(task.subtasks))
        .catch((error) => console.warn('No se pudo reparar el contador de subtareas:', error.cause ?? error));
    });
  }

  // Compara el tablero anterior con el actual: resalta las tarjetas que cambiaron de texto,
  // columna, etiqueta o subtareas en otro dispositivo y avisa de las ediciones de texto.
  function notifyRemoteChanges(previousTasks) {
    const previous = new Map(previousTasks.map((t) => [t.id, t]));
    const subtasksKey = (task) => JSON.stringify(task.subtasks ?? []);
    const changed = tasks.filter((t) => {
      const before = previous.get(t.id);
      return (
        before &&
        (['text', 'status', 'priority', 'dueDate'].some((field) => before[field] !== t[field]) ||
          subtasksKey(before) !== subtasksKey(t))
      );
    });
    emit(
      'highlight',
      changed.map((t) => t.id),
    );
    const edited = changed.filter((t) => previous.get(t.id).text !== t.text);
    if (edited.length > 0) emit('edited', edited);
  }

  // Completa el índice de las tareas existentes con los datos del servidor
  // (domain/usecases/CompleteTaskIndex.js). Es mantenimiento: si falla no se avisa a la persona,
  // y se reintenta en la siguiente sesión.
  function completeIndex() {
    completeTaskIndex({ currentTasks: () => tasks, cache, repository, now: now() }).catch((error) =>
      console.warn(
        'No se pudo completar el índice de tareas; se reintenta en la siguiente sesión:',
        error.cause ?? error,
      ),
    );
  }

  /* ---------- Historial ---------- */

  // Eventos de un cambio y cómo escribirlos (domain/rules/history.js), calculados con la tarea de
  // antes del cambio; null si no hay eventos (por ejemplo, al reordenar en la misma columna).
  function historyWriteFor(before, fields, at) {
    return planHistoryWrite(before, historyEventsFor(before, fields, { now: at, newId: newEventId }));
  }

  // Aplica el plan a la tarea local, como lo hará Firestore con el documento.
  function applyHistory(task, historyWrite) {
    if (!historyWrite) return;
    task.history =
      historyWrite.mode === 'replace' ? historyWrite.history : [...(task.history ?? []), ...historyWrite.events];
  }

  /* ---------- Acciones ---------- */

  // Cambia solo los campos indicados, así no pisa lo que otro dispositivo cambie a la vez. Sus
  // eventos del historial van en la misma escritura, con la hora at.
  function updateTask(id, fields, at = now()) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return false;
    const historyWrite = historyWriteFor(task, fields, at);
    Object.assign(task, fields);
    applyHistory(task, historyWrite);
    saveLocal();
    updateRemote(id, fields, historyWrite);
    return true;
  }

  // Aplica el resultado de un caso de uso de subtareas (lista y contador juntos, y al reabrir también la
  // columna). Devuelve el resultado para que la vista explique un rechazo.
  function applySubtaskResult(id, result, at = now()) {
    if (!result.ok) return result;
    updateTask(id, result.changes, at);
    if ('order' in result.changes) sortTasks(tasks);
    emit('change');
    return result;
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
      const at = now();
      const history = historyEventsFor(null, { text }, { now: at, newId: newEventId });
      const result = addTask(tasks, { id: newId(), text, now: at, history });
      tasks = result.tasks;
      saveLocal();
      saveRemote(result.task);
      emit('change');
      emit('added', [result.task]);
    },

    // Mueve una tarea a otra columna; si se indica beforeId, la coloca antes de esa tarea.
    // Con subtareas pendientes no la completa: emite blocked para que la vista explique qué falta.
    move(id, status, beforeId = null) {
      const at = now();
      const before = tasks.find((t) => t.id === id);
      const result = moveTask(tasks, { id, status, beforeId, now: at });
      if (!result.ok) {
        if (result.reason === 'wip-limit') {
          emit(
            'notice',
            `Límite WIP alcanzado: termina una tarea "En curso" antes de empezar otra (máx. ${result.limit}).`,
          );
        }
        if (result.reason === 'open-subtasks') {
          const { open, total, pending } = result;
          emit('blocked', { id, open, total, pending });
        }
        return;
      }
      const historyWrite = historyWriteFor(before, result.changes, at);
      applyHistory(result.task, historyWrite);
      tasks = result.tasks;
      saveLocal();
      const completing = status === 'completed' && before.status !== 'completed';
      const rejected = completing ? BOARD_MESSAGES.subtasks.completeRejected(clipText(before.text)) : null;
      updateRemote(id, result.changes, historyWrite, rejected);
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

    /* ---------- Subtareas (docs/PLAN_SUBTAREAS.md, 2.4) ---------- */
    // Cada acción devuelve el resultado del caso de uso: { ok: true, ... } o { ok: false, reason }, para
    // que la vista explique el rechazo (BOARD_MESSAGES.subtasks.reasons).

    addSubtask(id, text) {
      return applySubtaskResult(id, addSubtask(tasks, { id, subtaskId: newEventId(), text }));
    },

    editSubtask(id, subtaskId, text) {
      return applySubtaskResult(id, editSubtask(tasks, { id, subtaskId, text }));
    },

    // Desmarcar una subtarea de una tarea completada necesita reopen (la persona confirmó volver a En
    // curso); con En curso lleno no se reabre y se avisa.
    toggleSubtask(id, subtaskId, done, { reopen = false } = {}) {
      const at = now();
      const result = toggleSubtask(tasks, { id, subtaskId, done, reopen, now: at });
      if (!result.ok && result.reason === 'wip-limit') emit('notice', BOARD_MESSAGES.subtasks.reopenFull(result.limit));
      return applySubtaskResult(id, result, at);
    },

    removeSubtask(id, subtaskId) {
      return applySubtaskResult(id, removeSubtask(tasks, { id, subtaskId }));
    },

    reorderSubtask(id, subtaskId, direction) {
      return applySubtaskResult(id, reorderSubtask(tasks, { id, subtaskId, direction }));
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
        repairSubtaskCounters(snapshot.drifted ?? []);
        saveLocal();
        // Los cambios propios ya están en previousTasks, así que solo se detectan los ajenos.
        if (!firstSnapshot) notifyRemoteChanges(previousTasks);
        emit('change');
        setSync(snapshot.fromCache ? 'offline' : 'online');

        // Las tareas creadas en este navegador ya se anunciaron al crearlas.
        if (!firstSnapshot && snapshot.added.length > 0) emit('added', snapshot.added);
        // El primer snapshot que llega aquí es del servidor: con él se completa el índice.
        if (firstSnapshot) completeIndex();
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
