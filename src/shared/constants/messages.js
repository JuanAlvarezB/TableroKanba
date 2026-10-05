// Textos en español de los errores de autenticación y autorización.

const WRONG_CREDENTIALS = 'Correo o contraseña incorrectos.';
export const DENIED_MESSAGE = 'Tu cuenta no tiene acceso a LUCAS. Pídeselo al administrador.';

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
  'auth/account-exists-with-different-credential':
    'Ese correo ya entra con otro método. Inicia sesión con correo y contraseña.',
  'auth/unauthorized-domain': 'Este sitio no está autorizado para iniciar sesión con Google. Avisa al administrador.',
  'auth/operation-not-allowed': 'Este método de acceso no está habilitado. Avisa al administrador.',
  'auth/weak-password': 'Usa al menos 6 caracteres.',
};

export function errorMessage(error) {
  const code = error?.code ?? '';
  if (Object.hasOwn(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
  console.error('Error de Firebase:', error);
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}
