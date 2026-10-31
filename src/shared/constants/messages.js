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

// Avisos del tablero (presentation/state/boardStore.js y pages/board/).
export const BOARD_MESSAGES = {
  // La copia local no cupo con el historial (docs/PLAN_USUARIOS.md, A-42).
  historyNotStored:
    'Este navegador no tiene espacio para el historial de las tareas: la copia local se guardó sin él. El historial sigue guardado en el servidor.',
  // Confirmación de borrado (docs/PLAN_SUBTAREAS.md, 1.2). El texto de la tarea llega ya recortado.
  irreversible: 'Esta acción no se puede deshacer.',
  cancel: 'Cancelar',
  deleteTask: {
    title: '¿Borrar esta tarea?',
    text: (name) => `«${name}» se borrará con su historial.`,
    confirm: 'Borrar tarea',
    done: (name) => `Se borró la tarea «${name}».`,
    gone: 'La tarea ya no existe: se borró en otro dispositivo.',
  },
  clearCompleted: {
    title: '¿Borrar las tareas completadas?',
    text: (count) =>
      count === 1
        ? 'Se borrará 1 tarea completada con su historial. Las tareas pendientes y en curso no cambian.'
        : `Se borrarán ${count} tareas completadas con su historial. Las tareas pendientes y en curso no cambian.`,
    confirm: 'Borrar las completadas',
    done: (count) => (count === 1 ? 'Se borró 1 tarea completada.' : `Se borraron ${count} tareas completadas.`),
    gone: 'Ya no hay tareas completadas: se borraron o se movieron en otro dispositivo.',
  },
  // Subtareas (docs/PLAN_SUBTAREAS.md, 2.4 a 2.6 y 2.11). Motivos de rechazo de los casos de uso → texto.
  subtasks: {
    reasons: {
      empty: 'Una subtarea no puede quedar vacía.',
      'too-long': 'El texto de una subtarea puede tener hasta 200 caracteres.',
      limit: 'Llegaste al máximo de 20 subtareas.',
      completed: 'La tarea está completada. Desmarca una subtarea o devuélvela a En curso para cambiar la lista.',
    },
    reopenFull: (limit) => `En curso está llena (máx. ${limit}): termina o mueve una tarea antes de reabrir esta.`,
    // Las reglas rechazaron completarla: quizá otro dispositivo dejó una subtarea pendiente (P-14).
    completeRejected: (name) =>
      `No se pudo completar «${name}»: el servidor lo rechazó. Si tiene subtareas pendientes (quizá desde otro dispositivo), termínalas primero.`,
    // Tarjeta (docs/PLAN_SUBTAREAS.md, 2.10).
    progress: (done, total) => `${done} de ${total} subtareas`,
    openLabel: (done, total) => `Subtareas: ${done} de ${total} terminadas. Abrir lista`,
    addLabel: 'Agregar subtareas',
    // Diálogo de subtareas.
    status: (column, done, total) =>
      total === 0 ? `${column} · Sin subtareas` : `${column} · ${done} de ${total} subtareas terminadas`,
    listLabel: 'Subtareas',
    progressLabel: 'Progreso de las subtareas',
    empty: 'Divide la tarea en pasos pequeños. Cada paso se marca por separado.',
    newPlaceholder: 'Nueva subtarea',
    newLabel: 'Nueva subtarea',
    add: 'Agregar',
    count: (count, limit) => `${count} de ${limit}`,
    editField: 'Texto de la subtarea',
    edit: (name) => `Editar «${name}»`,
    up: (name) => `Subir «${name}»`,
    down: (name) => `Bajar «${name}»`,
    remove: (name) => `Borrar «${name}»`,
    save: 'Guardar',
    cancelEdit: 'Cancelar la edición',
    editEmpty: 'Una subtarea no puede quedar vacía: se mantuvo el texto anterior.',
    completeHint: (open) =>
      open === 1
        ? 'Termina la subtarea pendiente para completar la tarea.'
        : `Termina las ${open} subtareas pendientes para completar la tarea.`,
    lastNote: 'Marcar la última subtarea no completa la tarea: elige "Completar tarea".',
    readOnly: 'La tarea está completada. Desmarca una subtarea o devuélvela a En curso para cambiar la lista.',
    completedAt: (date) => `Completada el ${date}`,
    completedElsewhere: 'Se completó en otro dispositivo.',
    taskGone: 'La tarea se borró en otro dispositivo.',
    close: 'Cerrar',
    complete: 'Completar tarea',
    completed: (name) => `«${name}» pasó a Completada.`,
    // Anuncios para el lector de pantalla (aria-live).
    announceProgress: (done, total) => `${done} de ${total} subtareas terminadas.`,
    announceMoved: (name, position, total) => `«${name}» quedó en la posición ${position} de ${total}.`,
    announceAdded: (name) => `Subtarea agregada: «${name}».`,
    announceRemoved: (name) => `Subtarea borrada: «${name}».`,
    // Confirmaciones con BoardConfirm (2.5 a 2.7).
    removeConfirm: {
      title: '¿Borrar la subtarea?',
      text: (name) => `«${name}» se borrará de esta tarea.`,
      confirm: 'Borrar subtarea',
      gone: 'La subtarea ya no existe: se borró o cambió en otro dispositivo.',
    },
    reopenConfirm: {
      title: '¿Volver a abrir la tarea?',
      text: (task, subtask) =>
        `«${task}» está completada. Si marcas «${subtask}» como pendiente, la tarea vuelve a En curso.`,
      confirm: 'Volver a En curso',
      gone: 'La tarea cambió en otro dispositivo: revisa sus subtareas.',
    },
    completeConfirm: {
      title: '¿Completar la tarea?',
      text: (name, total) =>
        `«${name}» pasará a Completada. ${total === 1 ? 'Su subtarea está terminada.' : `Sus ${total} subtareas están terminadas.`}`,
      confirm: 'Completar tarea',
      gone: 'La tarea cambió en otro dispositivo: revisa sus subtareas.',
    },
    blocked: {
      title: 'Todavía no se puede completar',
      text: (name, open, total) => `«${name}»: ${open === 1 ? 'falta' : 'faltan'} ${open} de ${total} subtareas:`,
      more: (count) => `y ${count} más`,
      confirm: 'Ver subtareas',
    },
  },
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
    'set-permissions': 'Permisos actualizados.',
  },
  // Panel de permisos (3.7): sin diferencias no se escribe nada, y los motivos propios de los permisos
  // sustituyen a los generales (que hablan de rol, estado o eliminación).
  permissionsUnchanged: 'No había cambios que guardar.',
  permissionsReasons: {
    self: 'No puedes cambiar tus propios permisos.',
    'target-is-admin': 'Los administradores tienen siempre todas las funciones.',
    'unknown-feature': 'Esa función no existe. Recarga la página e inténtalo de nuevo.',
    'invalid-value': 'Valor de permiso no válido. Recarga la página e inténtalo de nuevo.',
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
