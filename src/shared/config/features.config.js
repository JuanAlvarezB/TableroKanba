// Valores iniciales de los permisos por función en cada ambiente (docs/PLAN_USUARIOS.md, 3.3). El catálogo,
// con el valor inicial de cada función, vive en domain/rules/features.js; aquí solo se ajusta, por ambiente,
// el de las funciones que se cumplen únicamente en la interfaz (stalledAlerts, reminders, history) o el de
// funciones futuras. board, priorities y dueDates no se ajustan: las reglas de Firestore asumen "ausente =
// activo" y features.config.test.js lo exige (A-37). La configuración de cada persona vive en Firestore
// (allowedUsers.permissions); un valor inicial solo cuenta mientras su clave no esté guardada.

/** @type {Record<'pdn' | 'qa' | 'dev', Record<string, boolean>>} */
export const FEATURE_DEFAULTS = {
  // Hoy, todas activas en los tres ambientes. QA copia a PDN: debe comportarse como PDN.
  pdn: { stalledAlerts: true, reminders: true, history: true },
  qa: { stalledAlerts: true, reminders: true, history: true },
  dev: { stalledAlerts: true, reminders: true, history: true },
};
