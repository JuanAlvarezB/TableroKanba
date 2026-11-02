import { beforeAll, describe, expect, it, vi } from 'vitest';

// firebase.config.js lee window.location al cargarse; en Node no existe, así que se simula.
vi.stubGlobal('window', { location: { hostname: 'localhost' } });

// Identificadores de prueba distintos por ambiente, para no depender de .env.local. Los reales los
// comprueba el build.
const TEST_PROJECT_IDS = { PDN: 'prueba-pdn', QA: 'prueba-qa', DEV: 'prueba-dev' };
Object.entries(TEST_PROJECT_IDS).forEach(([name, projectId]) => {
  vi.stubEnv(`VITE_FIREBASE_${name}_PROJECT_ID`, projectId);
});

let config;
beforeAll(async () => {
  config = await import('./firebase.config.js');
});

/**
 * Hosts aleatorios pero repetibles (semilla fija): si una prueba falla, falla igual en cada ejecución.
 * @param {number} count
 * @returns {string[]}
 */
function randomHosts(count) {
  let seed = 20261102;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-.';
  const endings = ['', '.web.app', '.firebaseapp.com', '.github.io', '.com'];
  return Array.from({ length: count }, () => {
    const length = 1 + (next() % 30);
    const name = Array.from({ length }, () => chars[next() % chars.length]).join('');
    return name + endings[next() % endings.length];
  });
}

describe('selectEnvironment', () => {
  it('usa PDN solo en el dominio de GitHub Pages', () => {
    expect(config.selectEnvironment('juanalvarezb.github.io').name).toBe('pdn');
  });

  it.each(['tablero-kanban-qa.web.app', 'tablero-kanban-qa.firebaseapp.com'])(
    'usa QA solo en los dominios de Hosting de QA (%j)',
    (hostname) => {
      expect(config.selectEnvironment(hostname).name).toBe('qa');
    },
  );

  it.each([
    'localhost',
    '127.0.0.1',
    '',
    'juanalvarezb.github.io.evil.com',
    'otro.github.io',
    'tablero-kanban-qa.web.app.evil.com',
    'evil-tablero-kanban-qa.web.app',
    'tablero-kanban-qa--pr1.web.app',
    'TABLERO-KANBAN-QA.WEB.APP',
    'tablero-kanban-qa.web.app.',
  ])('usa Desarrollo en cualquier otra dirección (%j)', (hostname) => {
    expect(config.selectEnvironment(hostname).name).toBe('dev');
  });

  it('usa Desarrollo en cualquier dirección que no esté en las listas', () => {
    const known = [...config.PDN_HOSTS, ...config.QA_HOSTS];
    const hosts = randomHosts(50).filter((hostname) => !known.includes(hostname));
    expect(hosts).toHaveLength(50);
    hosts.forEach((hostname) => {
      expect(config.selectEnvironment(hostname).name).toBe('dev');
    });
  });

  it('elige el ambiente de la página al cargarse', () => {
    expect(config.APP_ENV.name).toBe('dev');
  });
});

describe('ENVIRONMENTS', () => {
  it('tiene PDN, QA y Desarrollo, cada uno con su nombre', () => {
    expect(Object.keys(config.ENVIRONMENTS).sort()).toEqual(['dev', 'pdn', 'qa']);
    Object.entries(config.ENVIRONMENTS).forEach(([name, environment]) => {
      expect(environment.name).toBe(name);
    });
  });

  it('lee el proyecto de Firebase de las variables de su propio ambiente', () => {
    expect(config.ENVIRONMENTS.pdn.firebaseConfig.projectId).toBe(TEST_PROJECT_IDS.PDN);
    expect(config.ENVIRONMENTS.qa.firebaseConfig.projectId).toBe(TEST_PROJECT_IDS.QA);
    expect(config.ENVIRONMENTS.dev.firebaseConfig.projectId).toBe(TEST_PROJECT_IDS.DEV);
  });

  it('usa un proyecto de Firebase distinto en cada ambiente', () => {
    const projectIds = Object.values(config.ENVIRONMENTS).map(({ firebaseConfig }) => firebaseConfig.projectId);
    expect(new Set(projectIds).size).toBe(3);
  });

  // Cambiar estas claves haría que PDN dejara de encontrar las tareas guardadas en cada navegador.
  it('conserva las claves de localStorage de PDN y Desarrollo', () => {
    expect(config.ENVIRONMENTS.pdn).toMatchObject({ storageKey: 'tareas', migratedKey: 'tareas-migradas' });
    expect(config.ENVIRONMENTS.dev).toMatchObject({ storageKey: 'tareas-dev', migratedKey: 'tareas-migradas-dev' });
  });

  it('da a QA sus propias claves de localStorage', () => {
    expect(config.ENVIRONMENTS.qa).toMatchObject({ storageKey: 'tareas-qa', migratedKey: 'tareas-migradas-qa' });
  });

  // `tareas` (PDN) es prefijo de `tareas-dev` y `tareas-qa`, pero las claves reales llevan el uid
  // (`tareas-<uid>`, `tareas-qa-<uid>`) y la limpieza de las antiguas borra solo claves exactas: basta
  // con que las seis sean distintas.
  it('no comparte ninguna clave de localStorage entre ambientes', () => {
    const keys = Object.values(config.ENVIRONMENTS).flatMap(({ storageKey, migratedKey }) => [storageKey, migratedKey]);
    expect(new Set(keys).size).toBe(6);
  });
});
