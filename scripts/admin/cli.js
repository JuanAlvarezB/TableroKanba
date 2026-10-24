// Argumentos y ambiente del script administrativo (docs/PLAN_USUARIOS.md, 2.11): lógica pura, sin
// Firebase. Forma: npm run admin -- <comando> --ambiente dev|pdn.
import { parseArgs } from 'node:util';

export const ENVIRONMENTS = ['dev', 'pdn'];

export class UsageError extends Error {}

/**
 * @param {string[]} argv Argumentos después de `npm run admin --`.
 * @param {string[]} commands Comandos disponibles.
 * @returns {{ command: string, ambiente: 'dev' | 'pdn' }}
 */
export function parseCommand(argv, commands) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { ambiente: { type: 'string' } }, allowPositionals: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const [command, ...extra] = parsed.positionals;
  if (!command) throw new UsageError('Falta el comando.');
  if (!commands.includes(command)) throw new UsageError(`Comando desconocido: ${command}.`);
  if (extra.length > 0) throw new UsageError(`Sobran argumentos: ${extra.join(' ')}.`);
  const { ambiente } = parsed.values;
  if (!ENVIRONMENTS.includes(ambiente)) throw new UsageError('Indica el ambiente: --ambiente dev o --ambiente pdn.');
  return { command, ambiente };
}

/**
 * Identificador del proyecto de Firebase del ambiente, tomado de .firebaserc (alias dev y pdn), para
 * no repetirlo en el script.
 * @param {'dev' | 'pdn'} ambiente
 * @param {{ projects?: Record<string, string> }} firebaserc
 */
export function projectIdFor(ambiente, firebaserc) {
  const projectId = firebaserc.projects?.[ambiente];
  if (!projectId) throw new UsageError(`.firebaserc no define el alias "${ambiente}".`);
  return projectId;
}

/**
 * Explica en español los errores habituales de credenciales y permisos de Google.
 * @param {unknown} error
 * @param {string} projectId
 */
export function explainError(error, projectId) {
  const text = `${error?.code ?? ''} ${error?.message ?? error}`;
  if (/default credentials|invalid-credential|refresh token|invalid_grant/i.test(text)) {
    return 'No hay credenciales de Google válidas. Ejecuta: gcloud auth application-default login';
  }
  if (/quota project|x-goog-user-project/i.test(text)) {
    return `Falta el proyecto de cuota. Ejecuta: gcloud auth application-default set-quota-project ${projectId}`;
  }
  if (/permission|403|PERMISSION_DENIED|unauthenticated|401/i.test(text)) {
    return `Tu cuenta de Google no tiene permiso para leer las reglas de ${projectId} (necesita un rol en ese proyecto).`;
  }
  if (/not-found|404/i.test(text)) return `${projectId} no tiene reglas de Firestore publicadas.`;
  return `No se pudieron leer las reglas de ${projectId}: ${error?.message ?? error}`;
}
