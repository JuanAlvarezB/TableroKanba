// Acceso del script a Firestore y Authentication con el Admin SDK, que se salta las reglas
// (docs/PLAN_USUARIOS.md, 2.11). Las consultas de tareas e índices piden solo el campo ownerId: el texto
// y el historial de una tarea solo se descargan en el respaldo completo (readAll), que va cifrado.
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const BATCH_LIMIT = 500;

/**
 * @typedef {{ type: 'set' | 'update', collection: string, id: string, data: Record<string, unknown> }
 *   | { type: 'delete', collection: string, id: string }
 *   | { type: 'log', id: string, entry: import('../../src/domain/entities/AdminLog.js').LogEntry }} WriteOp
 *   'log' es una entrada de adminLog: el almacén le añade la hora del servidor (at).
 *
 * @typedef {object} Store
 * @property {(collection: string, id: string) => Promise<Record<string, unknown> | null>} get
 * @property {() => Promise<{ email: string, data: Record<string, unknown> }[]>} listUsers
 * @property {(collection: 'tasks' | 'taskIndex', uid?: string) => Promise<import('./taskIndex.js').OwnerRef[]>} listOwners
 *   Identificador y ownerId de cada documento (de todos, o solo los de ese uid).
 * @property {(collection: string, ids: string[]) => Promise<import('./taskIndex.js').OwnerRef[]>} ownersOf
 *   Los que existen de esos identificadores, con su ownerId.
 * @property {() => Promise<Record<string, number>>} countAll Documentos por colección.
 * @property {() => Promise<import('./backup.js').Collections>} readAll Todo el ambiente.
 * @property {(before: Date) => Promise<string[]>} logIdsBefore Entradas de adminLog anteriores a esa hora.
 * @property {(ops: WriteOp[]) => Promise<void>} commit Un lote atómico (500 operaciones como máximo).
 * @property {() => string} newId Identificador nuevo para una entrada de adminLog.
 * @property {(seconds: number, nanoseconds: number) => unknown} timestamp
 * @property {(email: string) => Promise<import('./accounts.js').Account | null>} findAccountByEmail
 * @property {(uid: string) => Promise<import('./accounts.js').Account | null>} findAccountByUid
 * @property {() => Promise<import('./accounts.js').Account[]>} listAccounts
 * @property {(uid: string) => Promise<void>} deleteAccount
 */

/**
 * @param {import('firebase-admin/app').App} app
 * @returns {Store}
 */
export function createStore(app) {
  const db = getFirestore(app);
  const auth = getAuth(app);
  const owners = (snapshots) => snapshots.map((doc) => ({ id: doc.id, ownerId: doc.get('ownerId') }));

  /** @returns {import('./accounts.js').Account} */
  const toAccount = (user) => ({
    uid: user.uid,
    email: user.email ?? null,
    disabled: user.disabled,
    createdAt: user.metadata.creationTime ?? null,
    lastSignInAt: user.metadata.lastSignInTime ?? null,
  });

  // getUserByEmail y getUser fallan con auth/user-not-found si la cuenta no existe.
  async function findAccount(lookup) {
    try {
      return toAccount(await lookup());
    } catch (error) {
      if (error?.code === 'auth/user-not-found') return null;
      throw error;
    }
  }

  return {
    async get(collection, id) {
      const snapshot = await db.collection(collection).doc(id).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    async listUsers() {
      const snapshot = await db.collection('allowedUsers').get();
      return snapshot.docs.map((doc) => ({ email: doc.id, data: doc.data() }));
    },

    async listOwners(collection, uid) {
      const query = uid ? db.collection(collection).where('ownerId', '==', uid) : db.collection(collection);
      return owners((await query.select('ownerId').get()).docs);
    },

    async ownersOf(collection, ids) {
      if (ids.length === 0) return [];
      const refs = ids.map((id) => db.collection(collection).doc(id));
      const snapshots = await db.getAll(...refs, { fieldMask: ['ownerId'] });
      return owners(snapshots.filter((snapshot) => snapshot.exists));
    },

    async countAll() {
      const counts = {};
      for (const collection of await db.listCollections()) {
        counts[collection.id] = (await collection.count().get()).data().count;
      }
      return counts;
    },

    async readAll() {
      const collections = {};
      for (const collection of await db.listCollections()) {
        const snapshot = await collection.get();
        collections[collection.id] = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
      }
      return collections;
    },

    async logIdsBefore(before) {
      const query = db.collection('adminLog').where('at', '<', Timestamp.fromDate(before));
      return (await query.select().get()).docs.map((doc) => doc.id);
    },

    async commit(ops) {
      if (ops.length > BATCH_LIMIT) throw new Error(`Un lote admite ${BATCH_LIMIT} escrituras como máximo.`);
      const batch = db.batch();
      for (const op of ops) {
        if (op.type === 'log') {
          batch.set(db.collection('adminLog').doc(op.id), { ...op.entry, at: FieldValue.serverTimestamp() });
          continue;
        }
        const ref = db.collection(op.collection).doc(op.id);
        if (op.type === 'set') batch.set(ref, op.data);
        else if (op.type === 'update') batch.update(ref, op.data);
        else batch.delete(ref);
      }
      await batch.commit();
    },

    newId: () => db.collection('adminLog').doc().id,
    timestamp: (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds),

    findAccountByEmail: (email) => findAccount(() => auth.getUserByEmail(email)),
    findAccountByUid: (uid) => findAccount(() => auth.getUser(uid)),

    async listAccounts() {
      const accounts = [];
      let pageToken;
      do {
        const page = await auth.listUsers(1000, pageToken);
        accounts.push(...page.users.map(toAccount));
        pageToken = page.pageToken;
      } while (pageToken);
      return accounts;
    },

    async deleteAccount(uid) {
      await auth.deleteUser(uid);
    },
  };
}
