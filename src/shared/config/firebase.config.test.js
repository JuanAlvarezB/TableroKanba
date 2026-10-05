import { beforeAll, describe, expect, it, vi } from 'vitest';

// firebase.config.js lee window.location al cargarse; en Node no existe, así que se simula.
vi.stubGlobal('window', { location: { hostname: 'localhost' } });

let config;
beforeAll(async () => {
  config = await import('./firebase.config.js');
});

describe('selectEnvironment', () => {
  it('usa PDN solo en el dominio de GitHub Pages', () => {
    expect(config.selectEnvironment('juanalvarezb.github.io').name).toBe('pdn');
  });

  it.each(['localhost', '127.0.0.1', '', 'juanalvarezb.github.io.evil.com', 'otro.github.io'])(
    'usa Desarrollo en cualquier otra dirección (%j)',
    (hostname) => {
      expect(config.selectEnvironment(hostname).name).toBe('dev');
    },
  );

  it('elige el ambiente de la página al cargarse', () => {
    expect(config.APP_ENV.name).toBe('dev');
  });
});

describe('ENVIRONMENTS', () => {
  // Cambiar estas claves haría que PDN dejara de encontrar las tareas guardadas en cada navegador.
  it('conserva las claves de localStorage de cada ambiente', () => {
    expect(config.ENVIRONMENTS.pdn).toMatchObject({ storageKey: 'tareas', migratedKey: 'tareas-migradas' });
    expect(config.ENVIRONMENTS.dev).toMatchObject({ storageKey: 'tareas-dev', migratedKey: 'tareas-migradas-dev' });
  });
});
