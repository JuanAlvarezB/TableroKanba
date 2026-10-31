// Permisos efectivos de la persona en el tablero (docs/PLAN_USUARIOS.md, 3.4), sin DOM: los componentes de
// la tarjeta y del aviso de recordatorio los leen de aquí. board/main.js los inicializa con los de la sesión;
// si cambian, la guardia recarga la página al revalidarla y se vuelven a leer. Hasta entonces no hay ninguna
// función habilitada (la página sigue oculta mientras se confirma la sesión).
import { FEATURE_KEYS } from '../../domain/rules/features.js';

/** @typedef {import('../../domain/rules/features.js').FeatureFlags} FeatureFlags */

const only = (features) =>
  Object.freeze(Object.fromEntries(FEATURE_KEYS.map((key) => [key, features?.[key] === true])));

let current = only({});

/**
 * Guarda los permisos efectivos de la sesión. Solo quedan las funciones del catálogo y solo true las enciende.
 * @param {FeatureFlags} features session.features
 */
export function setFeatures(features) {
  current = only(features);
}

/** @returns {Readonly<FeatureFlags>} */
export function currentFeatures() {
  return current;
}
