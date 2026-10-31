import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FEATURES, FEATURE_KEYS, featureDefaults } from '../../domain/rules/features.js';
import { FEATURE_DEFAULTS } from './features.config.js';

// firebase.config.js lee window.location al cargarse; en Node no existe, así que se simula.
vi.stubGlobal('window', { location: { hostname: 'localhost' } });

let ENVIRONMENTS;
beforeAll(async () => {
  ({ ENVIRONMENTS } = await import('./firebase.config.js'));
});

const ENFORCED = FEATURES.filter(({ enforcedInRules }) => enforcedInRules).map(({ key }) => key);

describe('FEATURE_DEFAULTS', () => {
  it('define los valores iniciales de cada ambiente', () => {
    expect(Object.keys(FEATURE_DEFAULTS).sort()).toEqual(Object.keys(ENVIRONMENTS).sort());
  });

  // Las reglas de Firestore tratan una clave ausente como activa (A-37): si un ambiente apagara una de
  // estas funciones por defecto, la interfaz y el servidor dejarían de coincidir.
  it.each(Object.keys(FEATURE_DEFAULTS))('%s: board, priorities y dueDates empiezan en true', (name) => {
    expect(ENFORCED).toEqual(['board', 'priorities', 'dueDates']);
    ENFORCED.forEach((key) => {
      expect(FEATURE_DEFAULTS[name]).not.toHaveProperty(key);
      expect(featureDefaults(FEATURE_DEFAULTS[name])[key]).toBe(true);
    });
  });

  it.each(Object.keys(FEATURE_DEFAULTS))('%s: solo ajusta funciones del catálogo, con valores booleanos', (name) => {
    Object.entries(FEATURE_DEFAULTS[name]).forEach(([key, value]) => {
      expect(FEATURE_KEYS).toContain(key);
      expect(typeof value).toBe('boolean');
    });
  });
});
