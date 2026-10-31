// Permisos por función (docs/PLAN_USUARIOS.md, sección 3): el catálogo de funciones, la regla única de
// permisos efectivos y los cambios del administrador. Los permisos de cada persona viven en
// allowedUsers.permissions; una clave ausente toma el valor inicial de su función. firestore.rules repite
// "ausente = activo", "solo true enciende" y "apagar el padre apaga las hijas" para las funciones que se
// cumplen en el servidor (perm, boardOn y childOn), y rules-tests/permisos.rules.test.js lo comprueba.

/**
 * @typedef {'board' | 'priorities' | 'dueDates' | 'stalledAlerts' | 'reminders' | 'history'} FeatureKey
 *
 * @typedef {object} Feature
 * @property {FeatureKey} key Clave en allowedUsers.permissions.
 * @property {FeatureKey | null} parent Función de la que depende; null en el padre.
 * @property {boolean} defaultValue Valor inicial: el de una clave ausente. Cada ambiente puede ajustarlo
 *   (shared/config/features.config.js) solo en las funciones que no se cumplen en las reglas.
 * @property {boolean} enforcedInRules firestore.rules la hace cumplir. Las reglas asumen "ausente =
 *   activo", así que su valor inicial es true en todos los ambientes (A-37).
 *
 * @typedef {Record<FeatureKey, boolean>} FeatureFlags Valor de cada función.
 *
 * @typedef {{ off?: FeatureKey[], on?: FeatureKey[] }} PermissionDiff Funciones que se apagan y que se
 *   encienden. Es el detail de la entrada set-permissions del registro: dos claves como máximo, sea cual
 *   sea el número de funciones (adminLog admite cinco).
 */

/** @type {Feature[]} */
export const FEATURES = [
  { key: 'board', parent: null, defaultValue: true, enforcedInRules: true },
  { key: 'priorities', parent: 'board', defaultValue: true, enforcedInRules: true },
  { key: 'dueDates', parent: 'board', defaultValue: true, enforcedInRules: true },
  { key: 'stalledAlerts', parent: 'board', defaultValue: true, enforcedInRules: false },
  { key: 'reminders', parent: 'board', defaultValue: true, enforcedInRules: false },
  { key: 'history', parent: 'board', defaultValue: true, enforcedInRules: false },
];

/** @type {FeatureKey[]} */
export const FEATURE_KEYS = FEATURES.map(({ key }) => key);

const PARENT = Object.fromEntries(FEATURES.map(({ key, parent }) => [key, parent]));

/**
 * Valores iniciales de un ambiente: los del catálogo con los ajustes del ambiente. Solo cuentan los
 * ajustes booleanos de funciones del catálogo.
 * @param {Record<string, unknown>} [overrides] Ajustes de shared/config/features.config.js.
 * @returns {FeatureFlags}
 */
export function featureDefaults(overrides = {}) {
  return Object.fromEntries(
    FEATURES.map(({ key, defaultValue }) => [key, typeof overrides[key] === 'boolean' ? overrides[key] : defaultValue]),
  );
}

// Valor propio de una función, sin mirar a su padre: el guardado si la clave existe (solo true la
// enciende: un dato corrupto apaga, nunca concede) o, si falta, el inicial.
function ownValue(stored, key, defaults) {
  return Object.hasOwn(stored, key) ? stored[key] === true : defaults[key] === true;
}

/**
 * Permisos efectivos de una persona. Un administrador tiene siempre todas las funciones; un miembro
 * tiene una función si su valor guardado (o el inicial) es true y su padre está activo: apagar el padre
 * apaga las hijas sin reescribirlas.
 * @param {{ role: string, permissions: Record<string, unknown> }} user AllowedUser o autorización.
 * @param {FeatureFlags} [defaults] Valores iniciales del ambiente (featureDefaults).
 * @returns {FeatureFlags}
 */
export function effectivePermissions(user, defaults = featureDefaults()) {
  const isOn = (key) =>
    user.role === 'admin' || (ownValue(user.permissions, key, defaults) && (PARENT[key] === null || isOn(PARENT[key])));
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, isOn(key)]));
}

/**
 * Mapa guardado tras cambiar una función. Solo cambia esa clave: al apagar o encender el padre, las hijas
 * conservan su valor y vuelven igual al reactivarlo. Del mapa anterior quedan solo las funciones del
 * catálogo, y un valor corrupto pasa a false (ya contaba como apagado), para que el mapa cumpla las reglas.
 * @param {Record<string, unknown>} stored allowedUsers.permissions tal como está.
 * @param {FeatureKey} key
 * @param {boolean} value
 * @returns {Partial<FeatureFlags>}
 */
export function applyPermissionChange(stored, key, value) {
  const kept = FEATURE_KEYS.filter((feature) => Object.hasOwn(stored, feature));
  return { ...Object.fromEntries(kept.map((feature) => [feature, stored[feature] === true])), [key]: value };
}

/**
 * Funciones cuyo valor propio (guardado o inicial) cambia entre dos mapas guardados, en el orden del
 * catálogo. Vacío si no cambia ninguna.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @param {FeatureFlags} [defaults] Valores iniciales del ambiente (featureDefaults).
 * @returns {PermissionDiff}
 */
export function permissionDiff(before, after, defaults = featureDefaults()) {
  const changed = FEATURE_KEYS.filter((key) => ownValue(before, key, defaults) !== ownValue(after, key, defaults));
  const off = changed.filter((key) => !ownValue(after, key, defaults));
  const on = changed.filter((key) => ownValue(after, key, defaults));
  return { ...(off.length > 0 && { off }), ...(on.length > 0 && { on }) };
}
