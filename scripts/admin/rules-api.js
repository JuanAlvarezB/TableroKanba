// Lectura de las reglas de Firestore publicadas con la API REST de Firebase Rules y un token de acceso
// (docs/PLAN_AMBIENTES.md, B.4 y P-6). La usa verificar-reglas en el CI: el Admin SDK de Node no acepta las
// credenciales de Workload Identity (external_account), y firebase.js sigue negándose a
// GOOGLE_APPLICATION_CREDENTIALS para todo lo demás. Mismo contrato que getSecurityRules(app) del Admin SDK.
// Solo lee.

const BASE_URL = 'https://firebaserules.googleapis.com/v1';

/** La API respondió con un error; el mensaje ya está explicado en español y nunca lleva el token. */
export class RulesApiError extends Error {}

/**
 * @param {number} status
 * @param {string} projectId
 */
function explainStatus(status, projectId) {
  if (status === 401) return 'El token de acceso no es válido o venció (dura una hora): vuelve a ejecutar el job.';
  if (status === 403) {
    return `La cuenta del CI no tiene permiso para leer las reglas de ${projectId} (necesita roles/firebaserules.admin).`;
  }
  if (status === 404) return `${projectId} no tiene reglas de Firestore publicadas.`;
  return `La API de Firebase Rules respondió ${status} al leer las reglas de ${projectId}.`;
}

/**
 * @param {object} deps
 * @param {string} deps.projectId
 * @param {string} deps.accessToken Token de acceso de Google (el que da google-github-actions/auth).
 * @param {typeof globalThis.fetch} [deps.fetch]
 * @returns {{ getFirestoreRuleset: () => Promise<{ name: string, createTime: string,
 *   source: { name: string, content: string }[] }> }}
 */
export function createRulesApi({ projectId, accessToken, fetch = globalThis.fetch }) {
  async function get(path) {
    let response;
    try {
      response = await fetch(`${BASE_URL}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (error) {
      throw new RulesApiError(`No se pudo conectar con la API de Firebase Rules: ${error?.message ?? error}`);
    }
    if (!response.ok) throw new RulesApiError(explainStatus(response.status, projectId));
    return response.json();
  }

  return {
    async getFirestoreRuleset() {
      // La publicación vigente de Firestore apunta al conjunto de reglas que se está aplicando.
      const release = await get(`projects/${projectId}/releases/cloud.firestore`);
      const prefix = `projects/${projectId}/rulesets/`;
      if (typeof release.rulesetName !== 'string' || !release.rulesetName.startsWith(prefix)) {
        throw new RulesApiError(`La publicación de Firestore de ${projectId} no apunta a un conjunto de reglas suyo.`);
      }
      const ruleset = await get(release.rulesetName);
      return {
        name: release.rulesetName.slice(prefix.length),
        createTime: ruleset.createTime,
        source: (ruleset.source?.files ?? []).map(({ name, content }) => ({ name, content })),
      };
    },
  };
}
