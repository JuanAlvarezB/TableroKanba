// AdminUsersRepository (domain/repositories/AdminUsersRepository.js) sobre Firestore. Cada cambio
// del administrador va en una sola operación con su entrada de adminLog: firestore.rules exige que
// lastChange apunte a una entrada nueva, escrita a la vez y con la hora del servidor (2.7 y 2.9).
import { userFromData } from '../../domain/entities/User.js';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { toRepositoryError } from './firebaseErrors.js';

const ALLOWED_USERS = 'allowedUsers';
const ADMIN_LOG = 'adminLog';

/**
 * @param {import('../datasources/firebase.init.js').FirebaseConnection} firebase
 * @returns {import('../../domain/repositories/AdminUsersRepository.js').AdminUsersRepository}
 */
export function createAdminUsersRepository({ db, fs }) {
  const userRef = (email) => fs.doc(db, ALLOWED_USERS, email);
  const logRef = (id) => fs.doc(db, ADMIN_LOG, id);
  const fail = (error) => {
    throw toRepositoryError(error);
  };

  // Documento de la entrada: sin el id (es el del documento) y con la hora del servidor.
  function logDocument({ id, ...entry }) {
    return { ...entry, at: fs.serverTimestamp() };
  }

  return {
    watch(onChange, onError) {
      return fs.onSnapshot(
        fs.collection(db, ALLOWED_USERS),
        (snapshot) => onChange(snapshot.docs.map((doc) => userFromData(doc.id, doc.data()))),
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
      const batch = fs.writeBatch(db);
      batch.update(userRef(email), { ...fields, lastChange: entry.id });
      batch.set(logRef(entry.id), logDocument(entry));
      return batch.commit().catch(fail);
    },
  };
}
