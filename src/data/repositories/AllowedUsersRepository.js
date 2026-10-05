// AllowedUsersRepository (domain/repositories/AuthRepository.js) sobre Firestore: la colección
// allowedUsers tiene un documento por persona autorizada, cuyo id es su correo en minúsculas.
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
      if (!snapshot.exists()) return null;
      const { name } = snapshot.data();
      return { name: typeof name === 'string' ? name.trim() : '' };
    },
  };
}
