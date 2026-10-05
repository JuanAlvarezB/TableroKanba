// Sesión compartida de LUCAS: confirma quién inició sesión y si está autorizado (colección
// allowedUsers) y cierra la sesión. La comparten las páginas autenticadas y el login.
import { createAllowedUsersRepository } from './data/repositories/AllowedUsersRepository.js';
import { createFirebaseAuthRepository } from './data/repositories/FirebaseAuthRepository.js';
import {
  readStorage,
  removeStorage,
  takeSessionValue,
  writeSessionValue,
  writeStorage,
} from './data/datasources/browserStorage.js';
import { loadFirebase } from './data/datasources/firebase.init.js';
import { displayName, hasPasswordProvider } from './domain/entities/Session.js';
import { APP_ENV } from './shared/config/firebase.config.js';
import { DENIED_MESSAGE } from './shared/constants/messages.js';

export const LUCAS_AUTH = (() => {
  const LOGIN_PAGE = 'login.html';
  const HOME_PAGE = 'index.html';

  // Aviso que login.html muestra al llegar (por ejemplo, "cuenta sin acceso").
  const LOGIN_MESSAGE_KEY = 'lucas-mensaje-login';

  // Copias del tablero anónimo: guardaban todas las tareas compartidas, así que no se suben
  // al tablero de nadie; se borran en cuanto alguien inicia sesión en este navegador.
  const LEGACY_KEYS = [APP_ENV.storageKey, APP_ENV.migratedKey];

  let services = null;
  let leaving = false;
  const cleanups = [];

  // Firebase y los repositorios de autenticación, creados una sola vez. Si Firebase no cargó
  // (sin internet, bloqueado), el siguiente intento vuelve a pedirlo.
  function loadServices() {
    if (!services) {
      services = loadFirebase().then((firebase) => ({
        firebase,
        auth: createFirebaseAuthRepository(firebase),
        allowedUsers: createAllowedUsersRepository(firebase),
      }));
      services.catch(() => {
        services = null;
      });
    }
    return services;
  }

  // Repositorio de autenticación para el login (inicia sesión, recupera la contraseña…).
  async function loadAuth() {
    return (await loadServices()).auth;
  }

  /* ---------- Almacenamiento local ---------- */

  // Claves propias de cada persona: así dos personas en el mismo navegador nunca ven la copia
  // local de la otra, ni por un instante.
  function storageKeys(uid) {
    return {
      tasks: `${APP_ENV.storageKey}-${uid}`,
      migrated: `${APP_ENV.migratedKey}-${uid}`,
      authorized: `lucas-autorizado-${APP_ENV.name}-${uid}`,
    };
  }

  function clearUserData(uid) {
    removeStorage(Object.values(storageKeys(uid)));
  }

  // Última autorización confirmada en este navegador ({ name }), o null.
  function readRemembered(uid) {
    try {
      const value = JSON.parse(readStorage(storageKeys(uid).authorized));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  /* ---------- Autorización ---------- */

  // Comprueba si la persona está en allowedUsers y tiene el correo verificado.
  // Devuelve { status: 'ok' | 'denied' | 'unverified' | 'offline', name, offline }.
  async function authorize(user) {
    const email = (user.email ?? '').toLowerCase();
    if (user.isAnonymous || !email) return { status: 'denied' };

    const { allowedUsers } = await loadServices();
    let allowed;
    try {
      allowed = await allowedUsers.find(email);
    } catch (error) {
      if (error.reason === 'permission-denied') return { status: 'denied' };
      // Sin red: vale la última autorización confirmada de esta persona en este navegador.
      const remembered = readRemembered(user.uid);
      if (remembered) return { status: 'ok', name: remembered.name, offline: true };
      console.error('No se pudo comprobar la autorización:', error.cause ?? error);
      return { status: 'offline' };
    }

    if (!allowed) {
      clearUserData(user.uid);
      return { status: 'denied' };
    }
    if (!user.emailVerified) return { status: 'unverified' };

    writeStorage(storageKeys(user.uid).authorized, JSON.stringify({ name: allowed.name }));
    removeStorage(LEGACY_KEYS);
    return { status: 'ok', name: allowed.name };
  }

  /* ---------- Navegación ---------- */

  // Devuelve el aviso pendiente para el login (y lo borra), o null.
  function takeLoginMessage() {
    return takeSessionValue(LOGIN_MESSAGE_KEY) === 'denied' ? DENIED_MESSAGE : null;
  }

  // Con replace, el botón "atrás" no vuelve a una página protegida.
  function goToLogin() {
    leaving = true;
    location.replace(LOGIN_PAGE);
  }

  // Dirección del login de este ambiente, para los correos de Firebase (botón "Continuar").
  function loginUrl() {
    return new URL(LOGIN_PAGE, location.href).href;
  }

  // Cierra la sesión de una cuenta que no puede entrar, sin dejar datos suyos en el navegador.
  async function rejectUser(user) {
    clearUserData(user.uid);
    try {
      await (await loadServices()).auth.signOut();
    } catch (error) {
      console.error('No se pudo cerrar la sesión:', error);
    }
  }

  // Muestra en la pantalla de carga que no se pudo verificar la sesión, con Reintentar.
  function showOfflineScreen() {
    const screen = document.getElementById('auth-screen');
    if (!screen) return;
    const message = document.createElement('p');
    message.textContent = 'Sin conexión, no se pudo verificar tu sesión.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'auth-retry';
    retry.textContent = 'Reintentar';
    retry.addEventListener('click', () => location.reload());
    screen.replaceChildren(message, retry);
    retry.focus();
  }

  // Promesa que nunca se resuelve: la página protegida no sigue cargando mientras se redirige
  // al login o se muestra la pantalla sin conexión.
  function halt() {
    return new Promise(() => {});
  }

  /* ---------- Páginas protegidas ---------- */

  // Funciones que la página registra para soltar sus recursos (por ejemplo, dejar de escuchar
  // Firestore) antes de que la sesión se cierre.
  function onSignOut(callback) {
    cleanups.push(callback);
  }

  function runCleanups() {
    cleanups.splice(0).forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error('Error al cerrar la sesión:', error);
      }
    });
  }

  // Si la sesión se cierra en otra pestaña (o cambia de persona), esta también sale.
  function watchSession(auth, uid) {
    auth.onChange((user) => {
      if (leaving || user?.uid === uid) return;
      runCleanups();
      clearUserData(uid);
      goToLogin();
    });
  }

  /**
   * Protege una página: devuelve la sesión si la persona está autorizada. Si no, la lleva al
   * login o muestra la pantalla sin conexión, y la promesa no se resuelve.
   * @returns {Promise<import('./domain/entities/Session.js').Session>}
   */
  async function requireSession() {
    let firebase;
    let auth;
    try {
      ({ firebase, auth } = await loadServices());
    } catch (error) {
      console.error('No se pudo cargar Firebase:', error);
      showOfflineScreen();
      return halt();
    }

    const user = await auth.restore();
    // Las sesiones anónimas del tablero anterior cuentan como "sin sesión".
    if (!user || user.isAnonymous) {
      if (user) await rejectUser(user);
      goToLogin();
      return halt();
    }

    const result = await authorize(user);
    if (result.status === 'denied') {
      await rejectUser(user);
      writeSessionValue(LOGIN_MESSAGE_KEY, 'denied');
      goToLogin();
      return halt();
    }
    // El login se encarga de pedir la verificación del correo.
    if (result.status === 'unverified') {
      goToLogin();
      return halt();
    }
    if (result.status === 'offline') {
      showOfflineScreen();
      return halt();
    }

    const keys = storageKeys(user.uid);
    watchSession(auth, user.uid);
    document.body.classList.remove('auth-pending');
    return {
      firebase,
      user,
      uid: user.uid,
      email: user.email,
      name: displayName(user, result.name),
      photoURL: user.photoURL,
      hasPassword: hasPasswordProvider(user),
      offline: Boolean(result.offline),
      storageKey: keys.tasks,
      migratedKey: keys.migrated,
    };
  }

  // Cambia la contraseña de la persona con sesión (cuenta.js).
  async function changePassword(session, current, next) {
    const { auth } = await loadServices();
    await auth.changePassword(session.user, current, next);
  }

  // Cierra la sesión después de que la persona lo confirma en el diálogo.
  async function signOut(session) {
    leaving = true;
    runCleanups();
    try {
      await (await loadServices()).auth.signOut();
    } catch (error) {
      console.error('No se pudo cerrar la sesión en Firebase:', error);
    }
    clearUserData(session.uid);
    location.replace(LOGIN_PAGE);
  }

  return {
    HOME_PAGE,
    loadAuth,
    authorize,
    rejectUser,
    requireSession,
    onSignOut,
    signOut,
    changePassword,
    takeLoginMessage,
    loginUrl,
  };
})();
