// Sesión compartida de LUCAS: confirma quién inició sesión y si está autorizado, protege las
// páginas autenticadas y cierra la sesión. La usan el inicio, el tablero y el login.
import { loadFirebase } from '../../data/datasources/firebase.init.js';
import { takeSessionValue, writeSessionValue } from '../../data/datasources/browserStorage.js';
import { createAllowedUsersRepository } from '../../data/repositories/AllowedUsersRepository.js';
import { createFirebaseAuthRepository } from '../../data/repositories/FirebaseAuthRepository.js';
import { createSessionStore } from '../../data/repositories/SessionStore.js';
import { displayName, hasPasswordProvider } from '../../domain/entities/Session.js';
import { accessChanged, accessState } from '../../domain/rules/permissions.js';
import { authorizeUser } from '../../domain/usecases/AuthorizeUser.js';
import { APP_ENV } from '../../shared/config/firebase.config.js';
import { LOGIN_MESSAGES } from '../../shared/constants/messages.js';

const LOGIN_PAGE = 'login.html';
export const HOME_PAGE = 'index.html';

// Aviso que login.html muestra al llegar (por ejemplo, "cuenta sin acceso").
const LOGIN_MESSAGE_KEY = 'lucas-mensaje-login';

// Al volver a la pestaña se revalida el acceso como máximo una vez por minuto.
const REVALIDATE_INTERVAL = 60 * 1000;

const sessionStore = createSessionStore(APP_ENV);

let services = null;
let leaving = false;
const cleanups = [];

// Persona de la página protegida y el rol y los permisos con los que entró, para revalidarla.
let current = null;
let checking = null;
let lastCheck = 0;

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
export async function loadAuth() {
  return (await loadServices()).auth;
}

/* ---------- Autorización ---------- */

// Comprueba si la persona está en allowedUsers, activa y con el correo verificado (ver
// domain/usecases/AuthorizeUser.js), y registra su uid la primera vez que entra.
export async function authorize(user) {
  const { allowedUsers } = await loadServices();
  const result = await authorizeUser(user, { allowedUsers, sessionStore, now: Date.now() });
  if (result.status === 'offline') console.error('No se pudo comprobar la autorización:', result.error);
  if (result.claimError) {
    console.warn('No se pudo registrar el uid; se reintenta en el siguiente acceso:', result.claimError);
  }
  return result;
}

/* ---------- Navegación ---------- */

// Devuelve el aviso pendiente para el login (y lo borra), o null.
export function takeLoginMessage() {
  const reason = takeSessionValue(LOGIN_MESSAGE_KEY);
  return Object.hasOwn(LOGIN_MESSAGES, reason) ? LOGIN_MESSAGES[reason] : null;
}

// Con replace, el botón "atrás" no vuelve a una página protegida.
function goToLogin() {
  leaving = true;
  location.replace(LOGIN_PAGE);
}

// Dirección del login de este ambiente, para los correos de Firebase (botón "Continuar").
export function loginUrl() {
  return new URL(LOGIN_PAGE, location.href).href;
}

// Cierra la sesión de una cuenta que no puede entrar, sin dejar datos suyos en el navegador.
export async function rejectUser(user) {
  sessionStore.forget(user.uid);
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
export function onSignOut(callback) {
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
    sessionStore.forget(uid);
    goToLogin();
  });
}

// Saca a quien perdió el acceso ('denied' o 'inactive'): suelta los recursos de la página, borra
// su copia local, cierra la sesión y la lleva al login con el aviso.
async function expel(user, reason) {
  leaving = true;
  runCleanups();
  await rejectUser(user);
  writeSessionValue(LOGIN_MESSAGE_KEY, reason);
  goToLogin();
}

async function checkAccess() {
  lastCheck = Date.now();
  const { user, access } = current;
  const result = await authorize(user);
  if (result.status === 'denied' || result.status === 'inactive') {
    await expel(user, result.status);
    return;
  }
  // Sin conexión no se puede saber; se comprueba en la siguiente ocasión.
  if (result.status !== 'ok' || result.offline) return;
  if (accessChanged(access, result)) location.reload();
}

/**
 * Vuelve a comprobar el acceso de la página abierta (docs/PLAN_USUARIOS.md, 1.4): si ya no
 * tiene acceso sale al login con el aviso; si cambió su rol o sus permisos, recarga la página; si
 * no cambió nada, no hace nada. La llaman la propia guardia al volver a la pestaña y el tablero
 * cuando las reglas rechazan una operación.
 */
export function revalidateSession() {
  if (!current || leaving) return Promise.resolve();
  checking ??= checkAccess()
    .catch((error) => console.error('No se pudo revalidar la sesión:', error))
    .finally(() => {
      checking = null;
    });
  return checking;
}

function watchAccess() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck >= REVALIDATE_INTERVAL) {
      revalidateSession();
    }
  });
}

/**
 * Protege una página: devuelve la sesión si la persona está autorizada. Si no, la lleva al
 * login o muestra la pantalla sin conexión, y la promesa no se resuelve. Con { role: 'admin' },
 * quien no es administrador (o está sin conexión) vuelve al inicio sin ver la página.
 * @param {{ role?: 'admin' }} [options]
 * @returns {Promise<import('../../domain/entities/Session.js').Session>}
 */
export async function requireSession({ role } = {}) {
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
  if (result.status === 'denied' || result.status === 'inactive') {
    await expel(user, result.status);
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
  if (role && accessState(result) !== role) {
    leaving = true;
    location.replace(HOME_PAGE);
    return halt();
  }

  const keys = sessionStore.keysFor(user.uid);
  current = { user, access: { role: result.role, permissions: result.permissions } };
  lastCheck = Date.now();
  watchSession(auth, user.uid);
  watchAccess();
  document.body.classList.remove('auth-pending');
  return {
    firebase,
    user,
    uid: user.uid,
    email: user.email,
    name: displayName(user, result.name),
    role: result.role,
    permissions: result.permissions,
    photoURL: user.photoURL,
    hasPassword: hasPasswordProvider(user),
    offline: Boolean(result.offline),
    storageKey: keys.tasks,
    migratedKey: keys.migrated,
    indexKey: keys.index,
  };
}

// Cambia la contraseña de la persona con sesión (zona de cuenta).
export async function changePassword(session, current, next) {
  const { auth } = await loadServices();
  await auth.changePassword(session.user, current, next);
}

// Cierra la sesión después de que la persona lo confirma en el diálogo.
export async function signOut(session) {
  leaving = true;
  runCleanups();
  try {
    await (await loadServices()).auth.signOut();
  } catch (error) {
    console.error('No se pudo cerrar la sesión en Firebase:', error);
  }
  sessionStore.forget(session.uid);
  location.replace(LOGIN_PAGE);
}
