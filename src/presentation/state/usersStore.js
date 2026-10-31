// Estado de la página de usuarios: la lista de personas autorizadas y los marcadores de
// eliminación (en vivo), el filtro y la búsqueda, y las acciones del administrador. Aplica los
// casos de uso del dominio sobre el estado más reciente de cada persona y traduce sus motivos a
// texto. No toca el DOM: la vista (pages/users/UsersPage.js) se suscribe (docs/PLAN_USUARIOS.md, 2.10).
//
// Eventos:
//   change      → la lista, los marcadores, el filtro o la búsqueda cambiaron: hay que volver a dibujar.
//   notice      → aviso de una acción terminada (texto).
//   progress    → avance del borrado de una persona: { email, done, total }.
//   error       → no se pudo escuchar la lista (texto).
//   access-lost → las reglas rechazaron una operación: quizá ya no es administrador, así que la
//                 guardia revalida su acceso (presentation/guards/session.js, sección 1.4).
import { deletionKey } from '../../domain/entities/User.js';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { isBackupFresh, lifecycleOf, normalizeEmail } from '../../domain/rules/permissions.js';
import { authorizeEmail } from '../../domain/usecases/admin/AuthorizeEmail.js';
import { cancelUserDeletion } from '../../domain/usecases/admin/CancelUserDeletion.js';
import { deactivateUser } from '../../domain/usecases/admin/DeactivateUser.js';
import { demoteUser } from '../../domain/usecases/admin/DemoteUser.js';
import { promoteUser } from '../../domain/usecases/admin/PromoteUser.js';
import { reactivateUser } from '../../domain/usecases/admin/ReactivateUser.js';
import { runUserDeletion } from '../../domain/usecases/admin/RunUserDeletion.js';
import { startUserDeletion } from '../../domain/usecases/admin/StartUserDeletion.js';
import { USERS_MESSAGES } from '../../shared/constants/messages.js';

/** @typedef {'all' | 'active' | 'inactive' | 'deleting' | 'admin'} UserFilter */

/** @type {UserFilter[]} */
export const USER_FILTERS = ['all', 'active', 'inactive', 'deleting', 'admin'];

const CHANGES = {
  deactivate: deactivateUser,
  reactivate: reactivateUser,
  promote: promoteUser,
  demote: demoteUser,
};

/** @typedef {keyof typeof CHANGES} UserChange */

/**
 * @typedef {object} UserRow
 * @property {import('../../domain/entities/User.js').AllowedUser} user
 * @property {import('../../domain/rules/permissions.js').Lifecycle} lifecycle
 * @property {boolean} self Fila de quien tiene la sesión: sin acciones.
 * @property {import('../../domain/entities/User.js').DeletionMarker | null} marker Su marcador de
 *   eliminación, si el script ya hizo su respaldo.
 * @property {boolean} backupReady Hay un respaldo verificado de menos de 24 horas sin confirmar:
 *   se puede eliminar definitivamente.
 *
 * @typedef {{ ok: true, message: string } | { ok: false, reason: string, message: string }} ActionResult
 */

// Sin tildes ni mayúsculas, para que buscar "jose" encuentre "José".
const searchable = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.email.localeCompare(b.email);

function matchesFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'admin') return row.user.role === 'admin';
  return row.lifecycle === filter;
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * @param {{ newId?: () => string, now?: () => number }} [deps]
 */
export function createUsersStore({ newId = createId, now = () => Date.now() } = {}) {
  /** @type {import('../../domain/entities/User.js').AllowedUser[]} */
  let users = [];
  /** @type {Map<string, import('../../domain/entities/User.js').DeletionMarker>} */
  let markers = new Map();
  let loaded = false;
  /** @type {UserFilter} */
  let filter = 'all';
  let query = '';
  /** @type {import('../../domain/repositories/AdminUsersRepository.js').AdminUsersRepository | null} */
  let repository = null;
  let stopWatching = [];
  /** @type {{ uid: string, email: string, role: 'admin' | 'member' } | null} */
  let session = null;

  const listeners = new Map();
  function emit(type, payload) {
    (listeners.get(type) ?? []).forEach((listener) => listener(payload));
  }

  // Quien actúa, con su estado más reciente de la lista (si otro administrador lo degradó, el
  // dominio lo rechaza antes de escribir) y el uid de la sesión, que es el que exigen las reglas.
  function actor() {
    const own = users.find((user) => user.email === session.email);
    return own
      ? { ...own, uid: session.uid }
      : {
          email: session.email,
          name: '',
          role: session.role,
          active: true,
          uid: session.uid,
          permissions: {},
          deleting: false,
        };
  }

  function failure(error) {
    if (!(error instanceof RepositoryError)) console.error('Error en la gestión de usuarios:', error);
    else console.error('Firestore rechazó o no completó el cambio:', error.cause ?? error);
    if (error?.reason === 'permission-denied') {
      emit('access-lost');
      return { ok: false, reason: 'permission-denied', message: USERS_MESSAGES.permissionDenied };
    }
    if (error?.reason === 'unavailable')
      return { ok: false, reason: 'unavailable', message: USERS_MESSAGES.unavailable };
    return { ok: false, reason: 'failed', message: USERS_MESSAGES.failed };
  }

  function rejected(reason) {
    // Si el dominio dice que ya no es administrador, la guardia lo comprueba con el servidor.
    if (reason === 'not-admin') emit('access-lost');
    return { ok: false, reason, message: USERS_MESSAGES.reasons[reason] ?? USERS_MESSAGES.failed };
  }

  const find = (email) => users.find((user) => user.email === email);
  const markerOf = (user) => markers.get(deletionKey(user)) ?? null;

  /** @returns {Promise<ActionResult>} */
  async function run(action, execute) {
    let result;
    try {
      result = await execute();
    } catch (error) {
      return failure(error);
    }
    if (!result.ok) return rejected(result.reason);
    emit('notice', USERS_MESSAGES.done[action]);
    return { ok: true, message: USERS_MESSAGES.done[action] };
  }

  // Fase 2 de la eliminación (2.5): borra por trozos avisando el avance. Si se corta a medias, el
  // mensaje dice cuánto se borró; la fila queda "En eliminación" con Reanudar eliminación.
  /** @returns {Promise<ActionResult>} */
  async function finishDeletion(target, marker) {
    let progress = { done: 0, total: marker?.taskCount ?? 0 };
    const onProgress = (next) => {
      progress = next;
      emit('progress', { email: target.email, ...next });
    };
    let result;
    try {
      result = await runUserDeletion(actor(), target, marker, { adminUsers: repository, onProgress });
    } catch (error) {
      const halted = failure(error);
      return {
        ...halted,
        message: `${halted.message} ${USERS_MESSAGES.deletionHalted(progress.done, progress.total)}`,
      };
    }
    if (!result.ok) return rejected(result.reason);
    return { ok: true, message: USERS_MESSAGES.done.delete };
  }

  function listenError(error) {
    console.error('No se pudo escuchar la lista de personas:', error.cause ?? error);
    if (error.reason === 'permission-denied') {
      emit('error', USERS_MESSAGES.permissionDenied);
      emit('access-lost');
    } else {
      emit('error', USERS_MESSAGES.unavailable);
    }
  }

  return {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },

    /**
     * Empieza a escuchar la lista de personas.
     * @param {import('../../domain/repositories/AdminUsersRepository.js').AdminUsersRepository} adminUsers
     * @param {{ uid: string, email: string, role: 'admin' | 'member' }} current Sesión del administrador.
     */
    connect(adminUsers, current) {
      repository = adminUsers;
      session = { uid: current.uid, email: normalizeEmail(current.email), role: current.role };
      stopWatching = [
        repository.watch((list) => {
          users = [...list].sort(byName);
          loaded = true;
          emit('change');
        }, listenError),
        // Los marcadores los crea el script en el equipo del administrador: la página se actualiza sola.
        repository.watchDeletions((list) => {
          markers = new Map(list.map((marker) => [marker.key, marker]));
          emit('change');
        }, listenError),
      ];
    },

    // Deja de escuchar (al cerrar la sesión).
    disconnect() {
      stopWatching.forEach((stop) => stop());
      stopWatching = [];
      repository = null;
    },

    /** Correo de quien tiene la sesión (va en el comando del respaldo). */
    sessionEmail() {
      return session?.email ?? '';
    },

    /** true cuando llegó la primera lista. */
    isLoaded() {
      return loaded;
    },

    /** @returns {UserFilter} */
    filter() {
      return filter;
    },

    /** @param {UserFilter} next */
    setFilter(next) {
      if (!USER_FILTERS.includes(next) || next === filter) return;
      filter = next;
      emit('change');
    },

    setQuery(text) {
      const next = searchable(String(text ?? '').trim());
      if (next === query) return;
      query = next;
      emit('change');
    },

    /** Total de personas autorizadas, sin filtrar. */
    total() {
      return users.length;
    },

    /**
     * Personas que muestran el filtro y la búsqueda actuales, por nombre.
     * @returns {UserRow[]}
     */
    rows() {
      const at = now();
      return users
        .map((user) => {
          const marker = markerOf(user);
          return {
            user,
            lifecycle: lifecycleOf(user),
            self: user.email === session?.email,
            marker,
            backupReady: marker?.state === 'backup-ready' && isBackupFresh(marker, at),
          };
        })
        .filter((row) => matchesFilter(row, filter))
        .filter((row) => !query || searchable(`${row.user.name} ${row.user.email}`).includes(query));
    },

    /**
     * Autoriza un correo. Dar el rol de administrador exige haber marcado la advertencia.
     * @param {{ email: string, name: string, role: string, adminConfirmed?: boolean }} input
     * @returns {Promise<ActionResult>}
     */
    authorize({ email, name, role, adminConfirmed = false }) {
      if (role === 'admin' && !adminConfirmed) return Promise.resolve(rejected('admin-not-confirmed'));
      return run('authorize', () => authorizeEmail(actor(), { email, name, role }, { adminUsers: repository, newId }));
    },

    /**
     * Desactiva, reactiva, promueve o degrada a otra persona, con su estado más reciente.
     * @param {UserChange} action
     * @param {string} email
     * @returns {Promise<ActionResult>}
     */
    change(action, email) {
      const target = find(email);
      if (!target) return Promise.resolve(rejected('not-found'));
      return run(action, () => CHANGES[action](actor(), target, { adminUsers: repository, newId }));
    },

    /**
     * Descarta el respaldo preparado de una persona (sin confirmar la eliminación).
     * @param {string} email
     * @returns {Promise<ActionResult>}
     */
    cancelDeletion(email) {
      const target = find(email);
      if (!target) return Promise.resolve(rejected('not-found'));
      return run('cancel-delete', () =>
        cancelUserDeletion(actor(), target, markerOf(target), { adminUsers: repository, newId }),
      );
    },

    /**
     * Confirma la eliminación con el correo escrito (fase 1) y enseguida borra sus datos (fase 2).
     * El borrado sigue con la persona y el marcador ya confirmados, sin esperar a la escucha.
     * @param {string} email
     * @param {string} confirmation Correo que escribió el administrador.
     * @returns {Promise<ActionResult>}
     */
    async deleteUser(email, confirmation) {
      const target = find(email);
      if (!target) return rejected('not-found');
      const marker = markerOf(target);
      let started;
      try {
        started = await startUserDeletion(
          actor(),
          target,
          { marker, confirmation },
          { adminUsers: repository, newId, now: now() },
        );
      } catch (error) {
        return failure(error);
      }
      if (!started.ok) return rejected(started.reason);
      return finishDeletion(
        { ...target, deleting: true, doneLogId: started.doneLogId },
        { ...marker, state: 'deleting' },
      );
    },

    /**
     * Retoma una eliminación confirmada que quedó a medias.
     * @param {string} email
     * @returns {Promise<ActionResult>}
     */
    resumeDeletion(email) {
      const target = find(email);
      if (!target) return Promise.resolve(rejected('not-found'));
      return finishDeletion(target, markerOf(target));
    },
  };
}
