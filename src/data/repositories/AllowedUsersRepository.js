// AllowedUsersRepository (domain/repositories/AuthRepository.js) sobre Firestore: la colección
// allowedUsers tiene un documento por persona autorizada, cuyo id es su correo en minúsculas.
import { userFromData } from '../../domain/entities/User.js';
import { toRepositoryError } from './firebaseErrors.js';

const ALLOWED_USERS = 'allowedUsers';

/**
 * @param {import('../datasources/firebase.init.js').FirebaseConnection} firebase
 * @returns {import('../../domain/repositories/AuthRepository.js').AllowedUsersRepository}
 */
export function createAllowedUsersRepository({ db, fs }) {
  return {
    async find(email) {
      let snapshot;
      try {
        snapshot = await fs.getDoc(fs.doc(db, ALLOWED_USERS, email));
      } catch (error) {
        throw toRepositoryError(error);
      }
      return snapshot.exists() ? userFromData(email, snapshot.data()) : null;
    },

    // Las reglas solo dejan escribir el campo uid, una vez y con el uid de la propia sesión.
    async claimUid(email, uid) {
      try {
        await fs.updateDoc(fs.doc(db, ALLOWED_USERS, email), { uid });
      } catch (error) {
        throw toRepositoryError(error);
      }
    },
  };
}
