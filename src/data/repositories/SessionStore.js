// Lo que el navegador recuerda de cada persona: sus claves de localStorage (llevan el ambiente
// y su uid, así dos personas en el mismo navegador nunca ven la copia local de la otra, ni por
// un instante) y su última autorización confirmada, para entrar sin conexión.
import { readStorage, removeStorage, writeStorage } from '../datasources/browserStorage.js';

/**
 * @param {import('../../shared/config/firebase.config.js').AppEnvironment} env
 */
export function createSessionStore(env) {
  function keysFor(uid) {
    return {
      tasks: `${env.storageKey}-${uid}`,
      migrated: `${env.migratedKey}-${uid}`,
      authorized: `lucas-autorizado-${env.name}-${uid}`,
    };
  }

  return {
    keysFor,

    // Última autorización confirmada en este navegador ({ name }), o null.
    remembered(uid) {
      try {
        const value = JSON.parse(readStorage(keysFor(uid).authorized));
        return value && typeof value === 'object' ? value : null;
      } catch {
        return null;
      }
    },

    remember(uid, name) {
      writeStorage(keysFor(uid).authorized, JSON.stringify({ name }));
    },

    // Borra todo lo de esa persona en este navegador (copia de tareas incluida).
    forget(uid) {
      removeStorage(Object.values(keysFor(uid)));
    },

    // Copias del tablero anónimo: guardaban todas las tareas compartidas, así que no se suben
    // al tablero de nadie; se borran en cuanto alguien inicia sesión en este navegador.
    clearLegacy() {
      removeStorage([env.storageKey, env.migratedKey]);
    },
  };
}
