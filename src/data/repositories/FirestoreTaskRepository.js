// TaskRepository (domain/repositories/TaskRepository.js) sobre Firestore. Cada tarea es un
// documento de la colección "tasks" con el uid de su dueño en ownerId: las reglas de seguridad
// exigen que ownerId sea el uid de quien escribe y que las consultas se limiten a él.
// Cada tarea tiene además su documento en "taskIndex" (mismo ID, solo ownerId), que se crea y se
// borra en el mismo lote que la tarea; editar o mover no lo toca (docs/PLAN_USUARIOS.md, 2.6).
import { taskFromData } from '../../domain/entities/Task.js';
import { toRepositoryError } from './firebaseErrors.js';

const TASKS_COLLECTION = 'tasks';
const INDEX_COLLECTION = 'taskIndex';

// Tareas por lote: con las reglas estrictas del índice, cada tarea cuesta dos llamadas
// existsAfter, más la lectura de quien escribe: 1 + 8 × 2 = 17, por debajo del límite de 20
// llamadas por lote (2.6). Los trozos no son atómicos entre sí: si uno falla, el siguiente
// intento continúa (A-23).
export const TASK_CHUNK_SIZE = 8;

function chunks(items) {
  const result = [];
  for (let i = 0; i < items.length; i += TASK_CHUNK_SIZE) result.push(items.slice(i, i + TASK_CHUNK_SIZE));
  return result;
}

// Campos de la tarea que se guardan en Firestore (todo menos el id, que es el del documento),
// más el dueño. Las etiquetas vacías no se envían: una tarea nueva no las necesita. El historial
// se conserva, porque save y saveAll reemplazan el documento entero; si la tarea aún no tiene
// (null), no se envía.
export function toDocument({ id, ...data }, ownerId) {
  ['priority', 'dueDate'].forEach((field) => {
    if (data[field] === null) delete data[field];
  });
  if (!Array.isArray(data.history)) delete data.history;
  return { ...data, ownerId };
}

// Campos de update con el historial del plan (domain/rules/history.js): arrayUnion no pisa los
// eventos que otro dispositivo añada a la vez y funciona sin conexión; al compactar se envía la
// lista entera.
function withHistory(fs, fields, historyWrite) {
  if (historyWrite?.mode === 'append') return { ...fields, history: fs.arrayUnion(...historyWrite.events) };
  if (historyWrite?.mode === 'replace') return { ...fields, history: historyWrite.history };
  return fields;
}

/**
 * @param {import('../datasources/firebase.init.js').FirebaseConnection} firebase
 * @param {string} ownerId uid de la persona con sesión.
 * @returns {import('../../domain/repositories/TaskRepository.js').TaskRepository}
 */
export function createFirestoreTaskRepository({ db, fs }, ownerId) {
  const ref = (id) => fs.doc(db, TASKS_COLLECTION, id);
  const indexRef = (id) => fs.doc(db, INDEX_COLLECTION, id);
  const fail = (error) => {
    throw toRepositoryError(error);
  };

  // Escribe los elementos en lotes de TASK_CHUNK_SIZE, uno tras otro.
  async function commitInChunks(items, write) {
    for (const chunk of chunks(items)) {
      const batch = fs.writeBatch(db);
      chunk.forEach((item) => write(batch, item));
      await batch.commit().catch(fail);
    }
  }

  function setTask(batch, task) {
    batch.set(ref(task.id), toDocument(task, ownerId));
    batch.set(indexRef(task.id), { ownerId });
  }

  return {
    save(task) {
      return commitInChunks([task], setTask);
    },

    update(id, fields, historyWrite = null) {
      return fs.updateDoc(ref(id), withHistory(fs, fields, historyWrite)).catch((error) => {
        // Otro dispositivo borró la tarea mientras se cambiaba aquí; el snapshot ya la quitará.
        if (error?.code === 'not-found') return;
        fail(error);
      });
    },

    remove(ids) {
      return commitInChunks(ids, (batch, id) => {
        batch.delete(ref(id));
        batch.delete(indexRef(id));
      });
    },

    saveAll(tasks) {
      return commitInChunks(tasks, setTask);
    },

    // Identificadores del índice de la persona, leídos del servidor (no de la caché): completar
    // el índice solo se decide con datos confirmados.
    async indexedIds() {
      const query = fs.query(fs.collection(db, INDEX_COLLECTION), fs.where('ownerId', '==', ownerId));
      const snapshot = await fs.getDocsFromServer(query).catch(fail);
      return snapshot.docs.map((doc) => doc.id);
    },

    addToIndex(ids) {
      return commitInChunks(ids, (batch, id) => batch.set(indexRef(id), { ownerId }));
    },

    removeFromIndex(ids) {
      return commitInChunks(ids, (batch, id) => batch.delete(indexRef(id)));
    },

    // Escucha los cambios de cualquier dispositivo, solo en las tareas de la persona. Sin
    // conexión, Firestore sigue reintentando por su cuenta.
    subscribe(onChange, onError) {
      const fromDoc = (doc) => taskFromData(doc.id, doc.data());
      return fs.onSnapshot(
        fs.query(fs.collection(db, TASKS_COLLECTION), fs.where('ownerId', '==', ownerId)),
        { includeMetadataChanges: true },
        (snapshot) => {
          onChange({
            tasks: snapshot.docs.map(fromDoc),
            // Las tareas creadas en este navegador llevan escrituras pendientes: no son ajenas.
            added: snapshot
              .docChanges()
              .filter((change) => change.type === 'added' && !change.doc.metadata.hasPendingWrites)
              .map((change) => fromDoc(change.doc)),
            fromCache: snapshot.metadata.fromCache,
          });
        },
        (error) => onError(toRepositoryError(error)),
      );
    },
  };
}
