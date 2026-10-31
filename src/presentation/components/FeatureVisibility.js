// Muestra u oculta lo que depende de una función o de un rol (docs/PLAN_USUARIOS.md, 3.4): un elemento con
// data-feature="<clave>" solo se ve con esa función habilitada y uno con data-role="admin", solo con ese rol.
// Ocultar no es seguridad: cada página tiene su guardia y las reglas de Firestore son la barrera real.
import { canOpenFeature } from '../../domain/rules/features.js';
import { FEATURE_MESSAGES } from '../../shared/constants/messages.js';

const GATED = '[data-feature], [data-role]';

/**
 * El elemento se ve con esta sesión: tiene la función de su data-feature y el rol de su data-role, si los
 * lleva.
 * @param {{ feature?: string, role?: string }} dataset
 * @param {{ role: string, features: Record<string, boolean> }} session
 */
export function isVisibleFor(dataset, session) {
  const featureOk = dataset.feature === undefined || canOpenFeature(session, dataset.feature);
  const roleOk = dataset.role === undefined || dataset.role === session.role;
  return featureOk && roleOk;
}

/**
 * Aplica la visibilidad a todo lo marcado dentro de root. Un elemento [data-feature-empty] (el lanzador del
 * inicio) muestra el aviso de "sin funciones" solo cuando no queda visible nada marcado en su contenedor.
 * @param {ParentNode} root
 * @param {import('../../domain/entities/Session.js').Session} session
 */
export function applyFeatureVisibility(root, session) {
  root.querySelectorAll(GATED).forEach((element) => {
    element.hidden = !isVisibleFor(element.dataset, session);
  });
  const empty = root.querySelector('[data-feature-empty]');
  if (!empty) return;
  const visible = [...empty.parentElement.querySelectorAll(GATED)].some((element) => !element.hidden);
  empty.textContent = visible ? '' : FEATURE_MESSAGES.none;
  empty.hidden = visible;
}

/**
 * Muestra el aviso de la función deshabilitada de la que viene la persona (la guardia la trajo al inicio).
 * Sin aviso no hace nada.
 * @param {HTMLElement} element
 * @param {string | null} message
 */
export function showFeatureNotice(element, message) {
  if (!message) return;
  element.textContent = message;
  element.hidden = false;
}
