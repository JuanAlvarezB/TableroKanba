// @vitest-environment happy-dom
// Pruebas del distintivo de ambiente (docs/PLAN_AMBIENTES.md, A.2) con un DOM simulado.
import { beforeEach, describe, expect, it } from 'vitest';
import { markEnvironment } from './EnvironmentBadge.js';

const TITLE = 'Inicio · LUCAS';

beforeEach(() => {
  document.title = TITLE;
  document.body.innerHTML = '<h1>LUCAS</h1>';
});

/** La página con el distintivo en el HTML, como el inicio, el login y los usuarios. */
function withBadgeInHtml() {
  document.body.innerHTML = '<h1>LUCAS <span id="env-badge" class="env-badge" hidden></span></h1>';
}

const badges = () => document.querySelectorAll('.env-badge');

describe('markEnvironment', () => {
  it('en Desarrollo antepone [DEV] y muestra DESARROLLO', () => {
    withBadgeInHtml();
    markEnvironment(document, { name: 'dev' });

    const badge = document.getElementById('env-badge');
    expect(document.title).toBe(`[DEV] ${TITLE}`);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('DESARROLLO');
    expect(badge.classList.contains('env-badge--qa')).toBe(false);
  });

  it('en QA antepone [QA] y muestra QA con su color', () => {
    withBadgeInHtml();
    markEnvironment(document, { name: 'qa' });

    const badge = document.getElementById('env-badge');
    expect(document.title).toBe(`[QA] ${TITLE}`);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('QA');
    expect(badge.classList.contains('env-badge--qa')).toBe(true);
  });

  it('en PDN no cambia nada', () => {
    withBadgeInHtml();
    markEnvironment(document, { name: 'pdn' });

    expect(document.title).toBe(TITLE);
    expect(document.getElementById('env-badge').hidden).toBe(true);
    expect(document.getElementById('env-badge').textContent).toBe('');
  });

  it('crea el distintivo dentro del h1 si la página no lo trae (tablero)', () => {
    markEnvironment(document, { name: 'qa' });

    expect(badges()).toHaveLength(1);
    expect(document.querySelector('h1 .env-badge').textContent).toBe('QA');
  });

  it('en PDN no crea el distintivo', () => {
    markEnvironment(document, { name: 'pdn' });

    expect(badges()).toHaveLength(0);
  });

  it.each(['dev', 'qa'])('%s: llamarla dos veces no duplica el prefijo ni el distintivo', (name) => {
    markEnvironment(document, { name });
    markEnvironment(document, { name });

    expect(document.title.match(/\[/g)).toHaveLength(1);
    expect(badges()).toHaveLength(1);
  });
});
