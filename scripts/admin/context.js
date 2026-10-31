// Piezas comunes de los comandos que leen o escriben datos (docs/PLAN_USUARIOS.md, 2.11): quién actúa,
// la confirmación de PDN, la simulación, las entradas de adminLog y la escritura por lotes.
import { buildLogEntry } from '../../src/domain/entities/AdminLog.js';
import { userFromData } from '../../src/domain/entities/User.js';
import { normalizeEmail } from '../../src/domain/rules/permissions.js';
import { maskEmail } from './accounts.js';

/**
 * Acciones que escribe el script en adminLog (2.7). La app escribe las suyas (AdminLog.js); las reglas
 * no aplican al Admin SDK, así que estas no necesitan estar en firestore.rules.
 * @typedef {'backup' | 'backfill-index' | 'purge-leftovers' | 'purge-log' | 'clean-auth' | 'restore'} ScriptAction
 */

/**
 * @typedef {object} CommandContext
 * @property {{ command: string, ambiente: 'dev' | 'pdn', aplicar: boolean, admin?: string, correo?: string,
 *   uid?: string, archivo?: string }} options
 * @property {string} projectId
 * @property {import('./store.js').Store} store
 * @property {ReturnType<typeof import('./terminal.js').createTerminal>} terminal
 * @property {(line: string) => void} log
 * @property {() => number} now
 * @property {string} backupDir Carpeta de respaldos (una subcarpeta por ambiente), fuera del repositorio.
 * @property {{ N: number, r: number, p: number }} [kdf] Coste del cifrado; solo las pruebas lo cambian.
 */

/** El script se niega: falta una condición de seguridad. Lo que no se escribió, no se escribe. */
export class Refusal extends Error {}

// Escrituras por lote del Admin SDK: el límite es 500; se deja margen.
export const CHUNK_SIZE = 400;

// Identificadores que se listan como máximo por grupo; del resto solo se da la cantidad.
const MAX_LISTED = 50;

/**
 * Comprueba que quien ejecuta el script es un administrador activo del ambiente, con su uid registrado
 * (el actorUid de sus entradas en adminLog).
 * @param {import('./store.js').Store} store
 * @param {string} email Valor de --admin.
 */
export async function requireAdmin(store, email) {
  const id = normalizeEmail(email);
  const data = await store.get('allowedUsers', id);
  if (!data)
    throw new Refusal(`${maskEmail(id)} no está en allowedUsers de este ambiente: --admin es tu correo de LUCAS.`);
  const admin = userFromData(id, data);
  if (admin.role !== 'admin' || !admin.active || admin.deleting) {
    throw new Refusal(`${maskEmail(id)} no es un administrador activo en este ambiente.`);
  }
  if (!admin.uid) {
    throw new Refusal('Tu documento de allowedUsers no tiene uid todavía: entra una vez en LUCAS en este ambiente.');
  }
  return admin;
}

/**
 * En PDN, antes de escribir, hay que teclear el identificador del proyecto.
 * @param {CommandContext} context
 */
export async function confirmWrite({ options, projectId, terminal }) {
  if (options.ambiente !== 'pdn') return;
  const answer = await terminal.ask(
    `Vas a escribir en PDN. Para continuar, escribe el identificador del proyecto (${projectId}): `,
  );
  if (answer.trim() !== projectId) throw new Refusal('El identificador no coincide: no se escribió nada.');
}

/** Fin de una simulación: nada se escribió. */
export function simulated(log) {
  log('Simulación: no se escribió nada. Repite el comando con --aplicar para hacerlo.');
  return 0;
}

/**
 * @param {import('./store.js').Store} store
 * @param {ScriptAction} action
 * @param {string} actorUid
 * @param {string | null} targetUid
 * @param {Record<string, string | number | boolean>} [detail]
 * @returns {import('./store.js').WriteOp}
 */
export function logOp(store, action, actorUid, targetUid, detail) {
  return { type: 'log', id: store.newId(), entry: buildLogEntry(action, actorUid, targetUid, detail) };
}

/**
 * Escribe las operaciones por lotes con la entrada del registro en el último: si caben en un lote, el
 * cambio y su entrada son atómicos. Si un lote falla a mitad, deja otra entrada con completed: false y
 * lo que alcanzó a escribir, para que ninguna ejecución que escribió quede sin rastro (2.7).
 * @param {import('./store.js').Store} store
 * @param {import('./store.js').WriteOp[]} ops
 * @param {{ action: ScriptAction, actorUid: string, targetUid: string | null,
 *   detail?: Record<string, string | number | boolean> }} entry
 * @param {(line: string) => void} log
 */
export async function commitWithLog(store, ops, { action, actorUid, targetUid, detail }, log) {
  const all = [...ops, logOp(store, action, actorUid, targetUid, detail)];
  let written = 0;
  try {
    for (let i = 0; i < all.length; i += CHUNK_SIZE) {
      const chunk = all.slice(i, i + CHUNK_SIZE);
      await store.commit(chunk);
      written += chunk.length;
    }
  } catch (error) {
    if (written > 0)
      await logFailure(store, logOp(store, action, actorUid, targetUid, { completed: false, written }), log);
    throw error;
  }
}

/** Entrada de una ejecución que falló después de escribir algo. */
export async function logFailure(store, op, log) {
  try {
    await store.commit([op]);
  } catch {
    log('⚠ No se pudo dejar la entrada en adminLog: anota esta ejecución en el registro privado.');
  }
}

/** Escribe las operaciones en lotes, sin entrada del registro (la deja quien llama). */
export async function commitInChunks(store, ops) {
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) await store.commit(ops.slice(i, i + CHUNK_SIZE));
}

/**
 * Imprime la cantidad y, si hay, los identificadores (nunca contenido).
 * @param {(line: string) => void} log
 * @param {string} label
 * @param {{ id: string }[]} items
 */
export function listIds(log, label, items) {
  log(`${label}: ${items.length}`);
  items.slice(0, MAX_LISTED).forEach(({ id }) => log(`  ${id}`));
  if (items.length > MAX_LISTED) log(`  … y ${items.length - MAX_LISTED} más`);
}

/** Fecha y hora UTC legibles: 2026-10-27 15:04 UTC. */
export const formatTime = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
