import { beforeAll, describe, expect, it, vi } from 'vitest';

// Simula vite --mode e2e (el servidor de Playwright) antes de cargar la configuración, que lee el modo y
// window.location al cargarse (docs/PLAN_AMBIENTES.md, E.2 y P-9).
vi.stubEnv('MODE', 'e2e');
vi.stubGlobal('window', { location: { hostname: 'localhost' } });
vi.stubEnv('VITE_FIREBASE_PDN_PROJECT_ID', 'prueba-pdn');
vi.stubEnv('VITE_FIREBASE_QA_PROJECT_ID', 'prueba-qa');

let config;
beforeAll(async () => {
  config = await import('./firebase.config.js');
});

describe('ambiente de los emuladores en modo e2e', () => {
  it('en localhost y 127.0.0.1 usa los emuladores con el proyecto ficticio demo-lucas', () => {
    ['localhost', '127.0.0.1'].forEach((host) => {
      const environment = config.selectEnvironment(host);
      expect(environment.firebaseConfig.projectId).toBe('demo-lucas');
      expect(environment.emulators).toEqual({
        auth: 'http://localhost:9099',
        firestore: { host: 'localhost', port: 8180 },
      });
    });
  });

  it('en los hosts de QA y PDN usa su ambiente, nunca los emuladores', () => {
    config.QA_HOSTS.forEach((host) => {
      expect(config.selectEnvironment(host)).toBe(config.ENVIRONMENTS.qa);
    });
    config.PDN_HOSTS.forEach((host) => {
      expect(config.selectEnvironment(host)).toBe(config.ENVIRONMENTS.pdn);
    });
    [...config.QA_HOSTS, ...config.PDN_HOSTS].forEach((host) => {
      expect(config.selectEnvironment(host).emulators).toBeUndefined();
    });
  });

  it('cualquier otro host usa Desarrollo, sin emuladores', () => {
    ['mi-equipo.local', 'localhost.evil.com', '192.168.1.10', 'tablero-kanban-dev.web.app'].forEach((host) => {
      expect(config.selectEnvironment(host)).toBe(config.ENVIRONMENTS.dev);
    });
  });

  it('se comporta como Desarrollo con claves de localStorage propias', () => {
    const keys = Object.values(config.ENVIRONMENTS).flatMap(({ storageKey, migratedKey }) => [storageKey, migratedKey]);
    expect(config.EMULATOR_ENVIRONMENT).toMatchObject({
      name: 'dev',
      storageKey: 'tareas-e2e',
      migratedKey: 'tareas-migradas-e2e',
    });
    expect(keys).not.toContain(config.EMULATOR_ENVIRONMENT.storageKey);
    expect(keys).not.toContain(config.EMULATOR_ENVIRONMENT.migratedKey);
  });

  it('la página carga en Desarrollo-emulador al abrirse en localhost', () => {
    expect(config.APP_ENV).toBe(config.EMULATOR_ENVIRONMENT);
  });
});
