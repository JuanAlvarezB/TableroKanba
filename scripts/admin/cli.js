// Argumentos y ambiente del script administrativo (docs/PLAN_USUARIOS.md, 2.11): lógica pura, sin
// Firebase. Forma: npm run admin -- <comando> --ambiente dev|pdn [opciones] [--aplicar].
import { parseArgs } from 'node:util';

export const ENVIRONMENTS = ['dev', 'pdn'];

// Opciones con valor que puede pedir un comando, con su marcador en la ayuda. --ambiente y --aplicar
// son comunes a todos.
const VALUE_OPTIONS = { admin: 'tu correo', correo: 'correo', uid: 'uid', archivo: 'ruta del respaldo' };

export class UsageError extends Error {}

/**
 * @typedef {object} CommandSpec
 * @property {string[]} [required] Opciones con valor obligatorias.
 * @property {string[]} [optional] Opciones con valor permitidas.
 * @property {boolean} [writes] Escribe datos: admite --aplicar (sin él, solo simula).
 */

/**
 * @param {string[]} argv Argumentos después de `npm run admin --`.
 * @param {Record<string, CommandSpec>} commands Comandos disponibles.
 * @returns {{ command: string, ambiente: 'dev' | 'pdn', aplicar: boolean, admin?: string, correo?: string,
 *   uid?: string, archivo?: string }}
 */
export function parseCommand(argv, commands) {
  const options = { ambiente: { type: 'string' }, aplicar: { type: 'boolean' } };
  Object.keys(VALUE_OPTIONS).forEach((name) => (options[name] = { type: 'string' }));
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const [command, ...extra] = parsed.positionals;
  if (!command) throw new UsageError('Falta el comando.');
  if (!Object.hasOwn(commands, command)) throw new UsageError(`Comando desconocido: ${command}.`);
  if (extra.length > 0) throw new UsageError(`Sobran argumentos: ${extra.join(' ')}.`);
  const { ambiente, aplicar = false, ...values } = parsed.values;
  if (!ENVIRONMENTS.includes(ambiente)) throw new UsageError('Indica el ambiente: --ambiente dev o --ambiente pdn.');

  const { required = [], optional = [], writes = false } = commands[command];
  if (aplicar && !writes) throw new UsageError(`${command} no escribe nada: no admite --aplicar.`);
  const result = { command, ambiente, aplicar };
  for (const [name, value] of Object.entries(values)) {
    if (!required.includes(name) && !optional.includes(name)) throw new UsageError(`${command} no usa --${name}.`);
    result[name] = value.trim();
  }
  const missing = required.find((name) => !result[name]);
  if (missing) throw new UsageError(`Falta --${missing}.`);
  return result;
}

/**
 * Línea de uso de cada comando, para la ayuda.
 * @param {Record<string, CommandSpec>} commands
 */
export function usage(commands) {
  const lines = Object.entries(commands).map(([name, { required = [], optional = [], writes }]) =>
    [
      `  ${name}`,
      ...required.map((option) => `--${option} <${VALUE_OPTIONS[option]}>`),
      ...optional.map((option) => `[--${option} <${VALUE_OPTIONS[option]}>]`),
      ...(writes ? ['[--aplicar]'] : []),
    ].join(' '),
  );
  return [
    'Uso: npm run admin -- <comando> --ambiente dev|pdn [opciones]',
    ...lines,
    'Sin --aplicar, los comandos que escriben solo simulan. --admin es tu correo de LUCAS.',
  ].join('\n');
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

const READ_RULES = 'leer las reglas';

/**
 * Explica en español los errores habituales de credenciales y permisos de Google.
 * @param {unknown} error
 * @param {string} projectId
 * @param {string} [task] Qué se intentaba, en infinitivo: "leer las reglas", "consultar Authentication"…
 */
export function explainError(error, projectId, task = READ_RULES) {
  const text = `${error?.code ?? ''} ${error?.message ?? error}`;
  if (/default credentials|invalid-credential|refresh token|invalid_grant/i.test(text)) {
    return 'No hay credenciales de Google válidas. Ejecuta: gcloud auth application-default login';
  }
  if (/quota project|x-goog-user-project/i.test(text)) {
    return `Falta el proyecto de cuota. Ejecuta: gcloud auth application-default set-quota-project ${projectId}`;
  }
  if (/permission|403|PERMISSION_DENIED|unauthenticated|401/i.test(text)) {
    return `Tu cuenta de Google no tiene permiso para ${task} en ${projectId} (necesita un rol en ese proyecto).`;
  }
  if (task === READ_RULES && /not-found|404/i.test(text))
    return `${projectId} no tiene reglas de Firestore publicadas.`;
  return `No se pudo ${task} en ${projectId}: ${error?.message ?? error}`;
}
