// Marca la página fuera de PDN (docs/PLAN_AMBIENTES.md, A.2): antepone el prefijo del ambiente a la pestaña y
// muestra su distintivo, para no confundir las pruebas con el tablero real. PDN no se marca.
import { ENVIRONMENT_LABELS } from '../../shared/constants/messages.js';

/**
 * Usa el #env-badge de la página si lo tiene (inicio, login, usuarios) o lo crea dentro del h1 (tablero).
 * Llamarla otra vez no duplica el prefijo ni el distintivo.
 * @param {Document} doc
 * @param {{ name: string }} env Ambiente de la página (APP_ENV).
 */
export function markEnvironment(doc, env) {
  const labels = ENVIRONMENT_LABELS[env.name];
  if (!labels) return;

  if (!doc.title.startsWith(`${labels.tab} `)) doc.title = `${labels.tab} ${doc.title}`;

  let badge = doc.getElementById('env-badge');
  if (!badge) {
    badge = doc.createElement('span');
    badge.id = 'env-badge';
    doc.querySelector('h1').append(' ', badge);
  }
  badge.className = 'env-badge';
  badge.classList.toggle(`env-badge--${env.name}`, env.name === 'qa');
  badge.textContent = labels.badge;
  badge.hidden = false;
}
