// Textos en español de los errores de autenticación y autorización, y avisos del tablero y de la
// gestión de usuarios.

const WRONG_CREDENTIALS = 'Correo o contraseña incorrectos.';

// Avisos del login según por qué la persona no pudo entrar o tuvo que salir. Solo los ve quien ya
// se autenticó con esa cuenta, así que no revelan qué correos existen.
export const LOGIN_MESSAGES = {
  denied: 'Tu cuenta no tiene acceso a LUCAS. Pídeselo al administrador.',
  inactive: 'Tu acceso a LUCAS fue desactivado. Habla con el administrador.',
};

// Permisos por función (docs/PLAN_USUARIOS.md, 3.4): el inicio sin funciones y el aviso que muestra al
// llegar desde una función deshabilitada (la guardia lleva al inicio). Solo los ve la propia persona.
export const FEATURE_MESSAGES = {
  none: 'No tienes funciones habilitadas. Habla con el administrador.',
  disabled: {
    board: 'El tablero de tareas no está habilitado para tu cuenta. Habla con el administrador.',
  },
};

// Avisos del tablero (presentation/state/boardStore.js).
export const BOARD_MESSAGES = {
  // La copia local no cupo con el historial (docs/PLAN_USUARIOS.md, A-42).
  historyNotStored:
    'Este navegador no tiene espacio para el historial de las tareas: la copia local se guardó sin él. El historial sigue guardado en el servidor.',
};

// Gestión de usuarios (presentation/state/usersStore.js; docs/PLAN_USUARIOS.md, 2.4). Neutros en
// género. Solo los ve un administrador autenticado, así que "ya autorizado" no revela correos a
// terceros.
export const USERS_MESSAGES = {
  // Motivo de rechazo de los casos de uso → texto.
  reasons: {
    'invalid-email': 'Escribe un correo válido.',
    'missing-name': 'Escribe el nombre que LUCAS mostrará.',
    'name-too-long': 'El nombre es demasiado largo (máximo 100 caracteres).',
    'unknown-role': 'Elige un rol: Miembro o Administrador.',
    'admin-not-confirmed': 'Marca la casilla para confirmar el rol de administrador.',
    'already-authorized': 'Ese correo ya está autorizado.',
    'in-deletion': 'Esa persona está en eliminación. Termina o cancela la eliminación primero.',
    self: 'No puedes cambiar tu propio rol ni tu estado, ni eliminarte.',
    'not-admin': 'Solo un administrador activo puede hacer este cambio.',
    'not-found': 'Esa persona ya no está en la lista.',
    'target-is-admin': 'No se puede eliminar a un administrador. Quítale primero el rol de administrador.',
    'target-active': 'Desactiva a la persona antes de eliminarla.',
    'no-backup': 'Falta el respaldo verificado. Ejecuta el script de respaldo y vuelve aquí.',
    'backup-stale': 'El respaldo tiene más de 24 horas. Vuelve a ejecutarlo.',
    'email-mismatch': 'El correo escrito no coincide.',
    'not-confirmed': 'La eliminación de esa persona no está confirmada.',
    leftovers: 'Quedan datos de la persona. Ejecuta el script de limpieza antes de terminar.',
  },
  permissionDenied: 'El servidor rechazó el cambio. Comprueba que sigues siendo administrador e inténtalo de nuevo.',
  unavailable: 'Sin conexión. Revisa tu internet e inténtalo de nuevo.',
  failed: 'No se pudo completar la operación. Inténtalo de nuevo.',
  // Aviso de cada acción terminada.
  done: {
    authorize: 'Correo autorizado. Si entrará con correo y contraseña, crea también su cuenta en Authentication.',
    deactivate: 'Acceso desactivado.',
    reactivate: 'Acceso reactivado.',
    promote: 'Rol de administrador concedido.',
    demote: 'Rol de administrador retirado.',
    'cancel-delete': 'Eliminación cancelada.',
    delete: 'Se eliminaron los datos de la persona. Recuerda borrar su cuenta en Authentication.',
  },
  // Eliminación en dos fases (2.4, flujo 5): avance y corte a medias.
  deletionProgress: (done, total) => `Borrando tareas: ${done} de ${total}.`,
  deletionHalted: (done, total) => `Se borraron ${done} de ${total} tareas. Pulsa Reanudar eliminación para terminar.`,
};

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
