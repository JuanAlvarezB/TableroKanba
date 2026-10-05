// Pantalla de inicio de sesión de LUCAS: Google (ventana emergente), correo y contraseña,
// recuperar contraseña y verificar el correo. Con una sesión autorizada lleva al inicio.
import { APP_ENV } from './shared/config/firebase.config.js';
import { LUCAS_AUTH } from './auth.js';

const RESEND_COOLDOWN = 60; // segundos entre envíos de correos de Firebase

// Errores de Firebase con la dirección de regreso (Dominios autorizados): se reintenta sin ella.
const CONTINUE_URL_ERRORS = [
  'auth/unauthorized-continue-uri',
  'auth/invalid-continue-uri',
  'auth/missing-continue-uri',
];

const loginStatus = document.getElementById('login-status');
const views = {
  signin: document.getElementById('view-signin'),
  reset: document.getElementById('view-reset'),
  verify: document.getElementById('view-verify'),
};

const signinForm = document.getElementById('signin-form');
const signinError = document.getElementById('signin-error');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const passwordToggle = document.querySelector('.toggle-password');
const signinSubmit = document.getElementById('signin-submit');
const googleBtn = document.getElementById('google-btn');
const forgotBtn = document.getElementById('forgot-btn');

const resetForm = document.getElementById('reset-form');
const resetError = document.getElementById('reset-error');
const resetDone = document.getElementById('reset-done');
const resetEmail = document.getElementById('reset-email');
const resetSubmit = document.getElementById('reset-submit');
const resetBack = document.getElementById('reset-back');

const verifyEmail = document.getElementById('verify-email');
const verifyError = document.getElementById('verify-error');
const verifyDone = document.getElementById('verify-done');
const verifySend = document.getElementById('verify-send');
const verifyCheck = document.getElementById('verify-check');
const verifySignout = document.getElementById('verify-signout');

// Firebase ya cargado ({ auth, authSdk, … }); null mientras carga o si no hay conexión.
let fb = null;

function showView(name) {
  loginStatus.hidden = true;
  Object.entries(views).forEach(([key, view]) => {
    view.hidden = key !== name;
  });
}

// Muestra el error (anunciado por lectores de pantalla) y lleva el foco al campo a corregir.
// Un mensaje vacío solo oculta el aviso (por ejemplo, la persona cerró la ventana de Google).
function showError(element, message, field) {
  element.textContent = message;
  element.hidden = !message;
  if (message && field) field.focus();
}

// Durante una operación se desactivan los botones para evitar dobles clics.
function setSigninBusy(busy) {
  [signinSubmit, googleBtn, forgotBtn].forEach((button) => {
    button.disabled = busy || !fb;
  });
  signinSubmit.textContent = busy ? 'Ingresando…' : 'Iniciar sesión';
}

// Desactiva un botón durante RESEND_COOLDOWN segundos, con la cuenta atrás en el texto.
function startCooldown(button, label) {
  let remaining = RESEND_COOLDOWN;
  button.disabled = true;
  button.textContent = `${label} (${remaining} s)`;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      button.textContent = `${label} (${remaining} s)`;
      return;
    }
    clearInterval(timer);
    button.disabled = false;
    button.textContent = label;
  }, 1000);
}

// Envía un correo de Firebase con regreso a login.html; si el dominio no está autorizado para
// la dirección de regreso, lo envía sin ella (el correo llega igual, sin botón "Continuar").
async function sendWithContinueUrl(send) {
  try {
    await send({ url: LUCAS_AUTH.loginUrl() });
  } catch (error) {
    if (!CONTINUE_URL_ERRORS.includes(error.code)) throw error;
    console.warn('Dirección de regreso no autorizada; se envía sin ella:', error);
    await send(undefined);
  }
}

/* ---------- Después de iniciar sesión ---------- */

// Decide a dónde va una persona con sesión: al inicio, a verificar el correo o fuera.
async function continueWith(user) {
  // Si verificó el correo en otra pestaña, el estado guardado puede estar viejo.
  if (!user.emailVerified) {
    try {
      await user.reload();
      await user.getIdToken(true);
    } catch {
      // Sin red se sigue con el estado conocido.
    }
  }

  const result = await LUCAS_AUTH.authorize(fb, user);
  if (result.status === 'ok') {
    location.replace(LUCAS_AUTH.HOME_PAGE);
    return;
  }
  if (result.status === 'unverified') {
    showVerify(user);
    return;
  }
  if (result.status === 'denied') {
    await LUCAS_AUTH.rejectUser(fb, user);
    showView('signin');
    showError(signinError, LUCAS_AUTH.DENIED_MESSAGE, emailInput);
    return;
  }
  showView('signin');
  showError(signinError, 'Sin conexión. Revisa tu internet.', emailInput);
}

/* ---------- Iniciar sesión ---------- */

passwordToggle.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  passwordToggle.textContent = show ? 'Ocultar' : 'Mostrar';
  passwordToggle.setAttribute('aria-pressed', String(show));
  passwordToggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

signinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!fb || signinSubmit.disabled) return;
  const email = emailInput.value.trim();
  if (!email) {
    showError(signinError, 'Escribe tu correo.', emailInput);
    return;
  }
  if (!passwordInput.value) {
    showError(signinError, 'Escribe tu contraseña.', passwordInput);
    return;
  }

  showError(signinError, '');
  setSigninBusy(true);
  try {
    const { user } = await fb.authSdk.signInWithEmailAndPassword(fb.auth, email, passwordInput.value);
    await continueWith(user);
  } catch (error) {
    const field = ['auth/invalid-email', 'auth/missing-email'].includes(error.code) ? emailInput : passwordInput;
    showError(signinError, LUCAS_AUTH.errorMessage(error), field);
  } finally {
    setSigninBusy(false);
  }
});

// La ventana de Google se abre directamente en el clic (Firebase ya está cargado): si se
// esperara algo antes, el navegador la bloquearía. Se usa ventana emergente, no redirección,
// porque el sitio no está en Firebase Hosting (ver docs/PLAN_LOGIN.md, sección 3.4).
googleBtn.addEventListener('click', async () => {
  if (!fb) return;
  showError(signinError, '');
  setSigninBusy(true);
  try {
    const provider = new fb.authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const { user } = await fb.authSdk.signInWithPopup(fb.auth, provider);
    await continueWith(user);
  } catch (error) {
    showError(signinError, LUCAS_AUTH.errorMessage(error), googleBtn);
  } finally {
    setSigninBusy(false);
  }
});

/* ---------- Recuperar contraseña ---------- */

forgotBtn.addEventListener('click', () => {
  showError(signinError, '');
  resetEmail.value = emailInput.value.trim();
  showView('reset');
  resetEmail.focus();
});

resetBack.addEventListener('click', () => {
  showView('signin');
  emailInput.focus();
});

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!fb || resetSubmit.disabled) return;
  const email = resetEmail.value.trim();
  if (!email) {
    showError(resetError, 'Escribe tu correo.', resetEmail);
    return;
  }

  showError(resetError, '');
  resetDone.hidden = true;
  resetSubmit.disabled = true;
  try {
    await sendWithContinueUrl((settings) => fb.authSdk.sendPasswordResetEmail(fb.auth, email, settings));
  } catch (error) {
    // El mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
    if (error.code !== 'auth/user-not-found') {
      resetSubmit.disabled = false;
      showError(resetError, LUCAS_AUTH.errorMessage(error), resetEmail);
      return;
    }
  }
  resetDone.hidden = false;
  startCooldown(resetSubmit, 'Enviar enlace');
});

/* ---------- Verificar el correo ---------- */

function showVerify(user) {
  verifyEmail.textContent = user.email;
  showError(verifyError, '');
  verifyDone.hidden = true;
  showView('verify');
  verifySend.focus();
}

verifySend.addEventListener('click', async () => {
  const user = fb.auth.currentUser;
  if (!user) return;
  showError(verifyError, '');
  verifySend.disabled = true;
  try {
    await sendWithContinueUrl((settings) => fb.authSdk.sendEmailVerification(user, settings));
  } catch (error) {
    verifySend.disabled = false;
    showError(verifyError, LUCAS_AUTH.errorMessage(error), verifySend);
    return;
  }
  verifyDone.textContent = `Te enviamos un enlace a ${user.email}. Ábrelo y después pulsa «Ya lo verifiqué». Revisa también la carpeta de spam.`;
  verifyDone.hidden = false;
  startCooldown(verifySend, 'Enviar enlace de verificación');
});

verifyCheck.addEventListener('click', async () => {
  const user = fb.auth.currentUser;
  if (!user) {
    showView('signin');
    return;
  }
  verifyCheck.disabled = true;
  showError(verifyError, '');
  await continueWith(user);
  verifyCheck.disabled = false;
  if (!views.verify.hidden && !user.emailVerified) {
    showError(
      verifyError,
      'Tu correo aún no aparece verificado. Abre el enlace del correo y vuelve a intentarlo.',
      verifyCheck,
    );
  }
});

verifySignout.addEventListener('click', async () => {
  const user = fb.auth.currentUser;
  if (user) await LUCAS_AUTH.rejectUser(fb, user);
  passwordInput.value = '';
  showView('signin');
  emailInput.focus();
});

/* ---------- Arranque ---------- */

async function startLogin() {
  if (APP_ENV.name === 'dev') {
    document.title = `[DEV] ${document.title}`;
    document.getElementById('env-badge').hidden = false;
  }

  const pendingMessage = LUCAS_AUTH.takeLoginMessage();
  setSigninBusy(true);
  try {
    fb = await LUCAS_AUTH.loadFirebase();
  } catch (error) {
    console.error('No se pudo cargar Firebase:', error);
    showView('signin');
    showError(
      signinError,
      'Sin conexión: no se pudo cargar el inicio de sesión. Revisa tu internet y recarga la página.',
    );
    return;
  }

  await fb.auth.authStateReady();
  const user = fb.auth.currentUser;
  // Con una sesión ya iniciada se va directo al inicio (o a verificar el correo).
  if (user && !user.isAnonymous) {
    await continueWith(user);
  } else {
    // Las sesiones anónimas del tablero anterior se cierran: ya no dan acceso.
    if (user) await LUCAS_AUTH.rejectUser(fb, user);
    showView('signin');
    if (pendingMessage) showError(signinError, pendingMessage);
  }
  setSigninBusy(false);
}

startLogin();
