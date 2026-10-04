// Sesión compartida de LUCAS: carga Firebase una sola vez, confirma quién inició sesión y si
// está autorizado (colección allowedUsers) y cierra la sesión. Es un script clásico con un
// global, igual que config.js, para que deploy.yml versione todas las rutas desde los HTML.
const LUCAS_AUTH = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/12.19.0';
  const LOGIN_PAGE = 'login.html';
  const HOME_PAGE = 'index.html';
  const ALLOWED_USERS = 'allowedUsers';

  // Aviso que login.html muestra al llegar (por ejemplo, "cuenta sin acceso").
  const LOGIN_MESSAGE_KEY = 'lucas-mensaje-login';

  // Copias del tablero anónimo: guardaban todas las tareas compartidas, así que no se suben
  // al tablero de nadie; se borran en cuanto alguien inicia sesión en este navegador.
  const LEGACY_KEYS = [APP_ENV.storageKey, APP_ENV.migratedKey];

  const WRONG_CREDENTIALS = 'Correo o contraseña incorrectos.';
  const DENIED_MESSAGE = 'Tu cuenta no tiene acceso a LUCAS. Pídeselo al administrador.';

  // Códigos de Firebase → texto en español. Los vacíos no muestran nada (la persona cerró la
  // ventana de Google a propósito). Los de credenciales comparten mensaje para no revelar
  // qué correos existen.
  const ERROR_MESSAGES = {
    'auth/invalid-credential': WRONG_CREDENTIALS,
    'auth/wrong-password': WRONG_CREDENTIALS,
    'auth/user-not-found': WRONG_CREDENTIALS,
    'auth/invalid-email': 'Escribe un correo válido.',
    'auth/missing-email': 'Escribe tu correo.',
    'auth/missing-password': 'Escribe tu contraseña.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    'auth/user-disabled': 'Esta cuenta está desactivada. Habla con el administrador.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
    'auth/popup-closed-by-user': '',
    'auth/cancelled-popup-request': '',
    'auth/user-cancelled': '',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio.',
    'auth/account-exists-with-different-credential': 'Ese correo ya entra con otro método. Inicia sesión con correo y contraseña.',
    'auth/unauthorized-domain': 'Este sitio no está autorizado para iniciar sesión con Google. Avisa al administrador.',
    'auth/operation-not-allowed': 'Este método de acceso no está habilitado. Avisa al administrador.',
    'auth/weak-password': 'Usa al menos 6 caracteres.',
  };

  let firebase = null;
  let leaving = false;
  const cleanups = [];

  function errorMessage(error) {
    const code = error?.code ?? '';
    if (Object.hasOwn(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
    console.error('Error de Firebase:', error);
    return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }

  // Carga los SDK desde el CDN e inicializa la app del ambiente (config.js) una sola vez.
  function loadFirebase() {
    if (!firebase) {
      firebase = Promise.all([
        import(`${FIREBASE_CDN}/firebase-app.js`),
        import(`${FIREBASE_CDN}/firebase-auth.js`),
        import(`${FIREBASE_CDN}/firebase-firestore.js`),
      ]).then(([appSdk, authSdk, fs]) => {
        const app = appSdk.initializeApp(APP_ENV.firebaseConfig);
        const auth = authSdk.getAuth(app);
        auth.languageCode = 'es';
        return { app, auth, authSdk, db: fs.getFirestore(app), fs };
      });
      // Si no cargó (sin internet, bloqueado), el siguiente intento vuelve a pedirlo.
      firebase.catch(() => {
        firebase = null;
      });
    }
    return firebase;
  }

  /* ---------- Almacenamiento local ---------- */

  // localStorage puede lanzar error (Safari con datos de sitio bloqueados); sin él, LUCAS
  // funciona igual, solo que sin copia local ni modo sin conexión.
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Sin almacenamiento no hay marca para el modo sin conexión; no pasa nada más.
    }
  }

  function removeStorage(keys) {
    keys.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nada que borrar si el navegador no permite usar localStorage.
      }
    });
  }

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
  async function authorize(fb, user) {
    const email = (user.email ?? '').toLowerCase();
    if (user.isAnonymous || !email) return { status: 'denied' };

    let snapshot;
    try {
      snapshot = await fb.fs.getDoc(fb.fs.doc(fb.db, ALLOWED_USERS, email));
    } catch (error) {
      if (error.code === 'permission-denied') return { status: 'denied' };
      // Sin red: vale la última autorización confirmada de esta persona en este navegador.
      const remembered = readRemembered(user.uid);
      if (remembered) return { status: 'ok', name: remembered.name, offline: true };
      console.error('No se pudo comprobar la autorización:', error);
      return { status: 'offline' };
    }

    if (!snapshot.exists()) {
      clearUserData(user.uid);
      return { status: 'denied' };
    }
    if (!user.emailVerified) return { status: 'unverified' };

    const name = typeof snapshot.data().name === 'string' ? snapshot.data().name.trim() : '';
    writeStorage(storageKeys(user.uid).authorized, JSON.stringify({ name }));
    removeStorage(LEGACY_KEYS);
    return { status: 'ok', name };
  }

  // Nombre visible: el de allowedUsers; si falta, el de Google; si falta, el correo sin dominio.
  function displayName(user, name) {
    return name || user.displayName || user.email.split('@')[0];
  }

  /* ---------- Navegación ---------- */

  function setLoginMessage(code) {
    try {
      sessionStorage.setItem(LOGIN_MESSAGE_KEY, code);
    } catch {
      // Sin sessionStorage el login se muestra sin el aviso.
    }
  }

  // Devuelve el aviso pendiente para el login (y lo borra), o null.
  function takeLoginMessage() {
    try {
      const code = sessionStorage.getItem(LOGIN_MESSAGE_KEY);
      sessionStorage.removeItem(LOGIN_MESSAGE_KEY);
      return code === 'denied' ? DENIED_MESSAGE : null;
    } catch {
      return null;
    }
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
  async function rejectUser(fb, user) {
    clearUserData(user.uid);
    try {
      await fb.authSdk.signOut(fb.auth);
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
  function watchSession(fb, uid) {
    fb.authSdk.onAuthStateChanged(fb.auth, (user) => {
      if (leaving || user?.uid === uid) return;
      runCleanups();
      clearUserData(uid);
      goToLogin();
    });
  }

  // Protege una página: devuelve la sesión si la persona está autorizada. Si no, la lleva al
  // login o muestra la pantalla sin conexión, y la promesa no se resuelve.
  async function requireSession() {
    let fb;
    try {
      fb = await loadFirebase();
    } catch (error) {
      console.error('No se pudo cargar Firebase:', error);
      showOfflineScreen();
      return halt();
    }

    await fb.auth.authStateReady();
    const user = fb.auth.currentUser;
    // Las sesiones anónimas del tablero anterior cuentan como "sin sesión".
    if (!user || user.isAnonymous) {
      if (user) await rejectUser(fb, user);
      goToLogin();
      return halt();
    }

    const result = await authorize(fb, user);
    if (result.status === 'denied') {
      await rejectUser(fb, user);
      setLoginMessage('denied');
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
    watchSession(fb, user.uid);
    document.body.classList.remove('auth-pending');
    return {
      ...fb,
      user,
      uid: user.uid,
      email: user.email,
      name: displayName(user, result.name),
      photoURL: user.photoURL,
      hasPassword: user.providerData.some((provider) => provider.providerId === 'password'),
      offline: Boolean(result.offline),
      storageKey: keys.tasks,
      migratedKey: keys.migrated,
    };
  }

  // Cierra la sesión después de que la persona lo confirma en el diálogo.
  async function signOut(session) {
    leaving = true;
    runCleanups();
    try {
      await session.authSdk.signOut(session.auth);
    } catch (error) {
      console.error('No se pudo cerrar la sesión en Firebase:', error);
    }
    clearUserData(session.uid);
    location.replace(LOGIN_PAGE);
  }

  return {
    HOME_PAGE,
    loadFirebase,
    authorize,
    rejectUser,
    requireSession,
    onSignOut,
    signOut,
    errorMessage,
    takeLoginMessage,
    loginUrl,
    DENIED_MESSAGE,
  };
})();
