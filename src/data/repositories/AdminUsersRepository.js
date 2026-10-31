// AdminUsersRepository (domain/repositories/AdminUsersRepository.js) sobre Firestore. Cada cambio
// del administrador va en una sola operación con su entrada de adminLog: firestore.rules exige que
// lastChange apunte a una entrada nueva, escrita a la vez y con la hora del servidor (2.7 y 2.9).
// Para eliminar a una persona solo se leen sus documentos de taskIndex, nunca sus tareas (2.5).
import { markerFromData, userFromData } from '../../domain/entities/User.js';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { toRepositoryError } from './firebaseErrors.js';

const ALLOWED_USERS = 'allowedUsers';
const ADMIN_LOG = 'adminLog';
const DELETIONS = 'deletions';
const TASKS = 'tasks';
const TASK_INDEX = 'taskIndex';

/**
 * @param {import('../datasources/firebase.init.js').FirebaseConnection} firebase
 * @returns {import('../../domain/repositories/AdminUsersRepository.js').AdminUsersRepository}
 */
export function createAdminUsersRepository({ db, fs }) {
  const userRef = (email) => fs.doc(db, ALLOWED_USERS, email);
  const logRef = (id) => fs.doc(db, ADMIN_LOG, id);
  const markerRef = (key) => fs.doc(db, DELETIONS, key);
  const indexOf = (uid) => fs.query(fs.collection(db, TASK_INDEX), fs.where('ownerId', '==', uid));
  const fail = (error) => {
    throw toRepositoryError(error);
  };

  // Documento de la entrada: sin el id (es el del documento) y con la hora del servidor.
  function logDocument({ id, ...entry }) {
    return { ...entry, at: fs.serverTimestamp() };
  }

  // Lote de escrituras con la entrada del registro al final.
  function commitWithEntry(write, entry) {
    const batch = fs.writeBatch(db);
    write(batch);
    batch.set(logRef(entry.id), logDocument(entry));
    return batch.commit().catch(fail);
  }

  return {
    watch(onChange, onError) {
      return fs.onSnapshot(
        fs.collection(db, ALLOWED_USERS),
        (snapshot) => onChange(snapshot.docs.map((doc) => userFromData(doc.id, doc.data()))),
        (error) => onError(toRepositoryError(error)),
      );
    },

    watchDeletions(onChange, onError) {
      return fs.onSnapshot(
        fs.collection(db, DELETIONS),
        (snapshot) => onChange(snapshot.docs.map((doc) => markerFromData(doc.id, doc.data())).filter(Boolean)),
        (error) => onError(toRepositoryError(error)),
      );
    },

    // Transacción de lectura y creación: si el correo ya está autorizado no se toca su documento.
    // Las transacciones necesitan conexión, igual que toda la página de usuarios.
    create({ email, name, role }, entry) {
      return fs
        .runTransaction(db, async (transaction) => {
          const existing = await transaction.get(userRef(email));
          if (existing.exists()) throw new RepositoryError('already-exists');
          transaction.set(userRef(email), { name, role, active: true, lastChange: entry.id });
          transaction.set(logRef(entry.id), logDocument(entry));
        })
        .catch(fail);
    },

    update(email, fields, entry) {
      return commitWithEntry((batch) => batch.update(userRef(email), { ...fields, lastChange: entry.id }), entry);
    },

    // Las dos horas son la del servidor: las reglas las comparan con request.time (2.9, notas del PR 3).
    startDeletion(email, key, entry, doneLogId) {
      return commitWithEntry((batch) => {
        batch.update(markerRef(key), { state: 'deleting', confirmedAt: fs.serverTimestamp() });
        batch.update(userRef(email), { deleting: { at: fs.serverTimestamp(), doneLogId }, lastChange: entry.id });
      }, entry);
    },

    cancelDeletion(key, entry) {
      return commitWithEntry((batch) => batch.delete(markerRef(key)), entry);
    },

    // Conteo en el servidor: cuesta una lectura por cada 1000 índices, no una por tarea.
    async countIndexed(uid) {
      const snapshot = await fs.getCountFromServer(indexOf(uid)).catch(fail);
      return snapshot.data().count;
    },

    // Del servidor, no de la caché: un índice ya borrado no debe volver a aparecer. Borrar algo que
    // ya no existe no es un error, así que repetir un trozo es seguro.
    async deleteTaskChunk(uid, limit) {
      const snapshot = await fs.getDocsFromServer(fs.query(indexOf(uid), fs.limit(limit))).catch(fail);
      if (snapshot.docs.length === 0) return { deleted: 0 };
      const batch = fs.writeBatch(db);
      snapshot.docs.forEach(({ id }) => {
        batch.delete(fs.doc(db, TASKS, id));
        batch.delete(fs.doc(db, TASK_INDEX, id));
      });
      await batch.commit().catch(fail);
      return { deleted: snapshot.docs.length };
    },

    finishDeletion(email, key, entry) {
      return commitWithEntry((batch) => {
        batch.delete(userRef(email));
        batch.delete(markerRef(key));
      }, entry);
    },
  };
}
