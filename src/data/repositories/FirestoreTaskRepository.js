// TaskRepository (domain/repositories/TaskRepository.js) sobre Firestore. Cada tarea es un
// documento de la colección "tasks" con el uid de su dueño en ownerId: las reglas de seguridad
// exigen que ownerId sea el uid de quien escribe y que las consultas se limiten a él.
import { taskFromData } from '../../domain/entities/Task.js';
import { toRepositoryError } from './firebaseErrors.js';

const TASKS_COLLECTION = 'tasks';

// Campos de la tarea que se guardan en Firestore (todo menos el id, que es el del documento),
// más el dueño. Las etiquetas vacías no se envían: una tarea nueva no las necesita.
export function toDocument({ id, ...data }, ownerId) {
  ['priority', 'dueDate'].forEach((field) => {
    if (data[field] === null) delete data[field];
  });
  return { ...data, ownerId };
}

/**
 * @param {import('../datasources/firebase.init.js').FirebaseConnection} firebase
 * @param {string} ownerId uid de la persona con sesión.
 * @returns {import('../../domain/repositories/TaskRepository.js').TaskRepository}
 */
export function createFirestoreTaskRepository({ db, fs }, ownerId) {
  const ref = (id) => fs.doc(db, TASKS_COLLECTION, id);
  const fail = (error) => {
    throw toRepositoryError(error);
  };

  return {
    save(task) {
      return fs.setDoc(ref(task.id), toDocument(task, ownerId)).catch(fail);
    },

    update(id, fields) {
      return fs.updateDoc(ref(id), fields).catch((error) => {
        // Otro dispositivo borró la tarea mientras se cambiaba aquí; el snapshot ya la quitará.
        if (error?.code === 'not-found') return;
        fail(error);
      });
    },

    remove(ids) {
      if (ids.length === 0) return Promise.resolve();
      const batch = fs.writeBatch(db);
      ids.forEach((id) => batch.delete(ref(id)));
      return batch.commit().catch(fail);
    },

    saveAll(tasks) {
      const batch = fs.writeBatch(db);
      tasks.forEach((task) => batch.set(ref(task.id), toDocument(task, ownerId)));
      return batch.commit().catch(fail);
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
