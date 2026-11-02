import { describe, expect, it } from 'vitest';
import { RulesApiError, createRulesApi } from './rules-api.js';
import { verifyRules } from './verificar-reglas.js';

const PROJECT = 'proyecto-qa';
const TOKEN = 'token-de-prueba-123';
const RULES = "rules_version = '2';\nservice cloud.firestore {}\n";
const RELEASE_URL = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`;
const RULESET_URL = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/abc-123`;

// fetch falso: responde por URL y guarda cada petición.
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: route.status === undefined, status: route.status ?? 200, json: async () => route.body };
  };
  return { fetch, calls };
}

const OK_ROUTES = {
  [RELEASE_URL]: { body: { name: 'cloud.firestore', rulesetName: `projects/${PROJECT}/rulesets/abc-123` } },
  [RULESET_URL]: {
    body: {
      name: `projects/${PROJECT}/rulesets/abc-123`,
      createTime: '2026-11-02T15:00:00.000Z',
      source: { files: [{ name: 'firestore.rules', content: RULES, fingerprint: 'xyz' }] },
    },
  },
};

const read = (routes) => {
  const { fetch, calls } = fakeFetch(routes);
  return { calls, result: createRulesApi({ projectId: PROJECT, accessToken: TOKEN, fetch }).getFirestoreRuleset() };
};

describe('rules-api: reglas publicadas con la API REST', () => {
  it('lee la publicación de Firestore del proyecto y luego su conjunto de reglas, con el token', async () => {
    const { calls, result } = read(OK_ROUTES);
    await result;
    expect(calls.map(({ url }) => url)).toEqual([RELEASE_URL, RULESET_URL]);
    calls.forEach(({ init }) => expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` }));
  });

  it('devuelve el mismo contrato que el Admin SDK', async () => {
    expect(await read(OK_ROUTES).result).toEqual({
      name: 'abc-123',
      createTime: '2026-11-02T15:00:00.000Z',
      source: [{ name: 'firestore.rules', content: RULES }],
    });
  });

  it('verificar-reglas funciona igual con este adaptador', async () => {
    const { fetch } = fakeFetch(OK_ROUTES);
    const lines = [];
    const code = await verifyRules({
      securityRules: createRulesApi({ projectId: PROJECT, accessToken: TOKEN, fetch }),
      localRules: RULES,
      label: `qa (${PROJECT})`,
      log: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('✔ Coinciden');
  });

  it.each([
    [401, 'no es válido o venció'],
    [403, `no tiene permiso para leer las reglas de ${PROJECT}`],
    [404, `${PROJECT} no tiene reglas de Firestore publicadas`],
    [500, 'respondió 500'],
  ])('explica en español un %i, sin mostrar el token', async (status, message) => {
    const error = await read({ [RELEASE_URL]: { status } }).result.catch((e) => e);
    expect(error).toBeInstanceOf(RulesApiError);
    expect(error.message).toContain(message);
    expect(error.message).not.toContain(TOKEN);
  });

  it('un fallo de red se explica sin mostrar el token', async () => {
    const error = await read({ [RELEASE_URL]: new Error('fetch failed') }).result.catch((e) => e);
    expect(error).toBeInstanceOf(RulesApiError);
    expect(error.message).toBe('No se pudo conectar con la API de Firebase Rules: fetch failed');
  });

  it('se niega a seguir una publicación que apunta a reglas de otro proyecto', async () => {
    const routes = { [RELEASE_URL]: { body: { rulesetName: 'projects/otro/rulesets/abc-123' } } };
    const { calls, result } = read(routes);
    await expect(result).rejects.toThrow('no apunta a un conjunto de reglas suyo');
    expect(calls).toHaveLength(1);
  });
});
