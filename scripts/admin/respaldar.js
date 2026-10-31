// Comando respaldar (PBI-2.8; docs/PLAN_USUARIOS.md, 2.5 fase A y 2.11): prepara la eliminación de una
// persona desactivada. Resuelve su uid, completa su índice, hace el respaldo completo cifrado del ambiente,
// lo verifica y solo entonces crea el marcador deletions/{clave} en 'backup-ready' con su entrada en
// adminLog. Sin ese marcador, las reglas no dejan al administrador borrar tareas ajenas.
// Sin --correo (PBI-2.11, 2.16 «Respaldo previo en PDN»), solo hace el respaldo completo antes de publicar
// reglas: no toca índices ni crea marcadores, y deja su entrada en adminLog.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userFromData } from '../../src/domain/entities/User.js';
import { canChangeUser, normalizeEmail } from '../../src/domain/rules/permissions.js';
import { maskEmail } from './accounts.js';
import { MIN_PASSPHRASE_LENGTH, backupFileName, encryptBackup, serializeBackup, verifyBackup } from './backup.js';
import { explainError } from './cli.js';
import { Refusal, commitInChunks, confirmWrite, logFailure, logOp, requireAdmin, simulated } from './context.js';
import { fingerprint } from './rules.js';
import { indexDiff, indexRepairOps } from './taskIndex.js';

/** @typedef {import('./context.js').CommandContext} CommandContext */

const REFUSALS = {
  self: 'No puedes respaldarte para eliminarte a ti mismo.',
  'in-deletion': 'La persona ya está en eliminación: termínala o reanúdala en la página Usuarios.',
  'target-is-admin': 'No se puede eliminar a un administrador: quítale primero el rol en la página Usuarios.',
  'target-active': 'La persona está activa: desactívala primero en la página Usuarios.',
};

/**
 * Frase nueva, tecleada dos veces. No se guarda: si se pierde, el respaldo no se puede leer.
 * @param {CommandContext['terminal']} terminal
 */
export async function askNewPassphrase(terminal) {
  const passphrase = await terminal.askHidden(
    `Frase de cifrado (mínimo ${MIN_PASSPHRASE_LENGTH} caracteres; guárdala en el gestor de contraseñas): `,
  );
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Refusal(`La frase debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres.`);
  }
  if ((await terminal.askHidden('Repite la frase: ')) !== passphrase) throw new Refusal('Las frases no coinciden.');
  return passphrase;
}

/**
 * Escribe el respaldo en su carpeta (0700) como un archivo nuevo de solo lectura y escritura para ti (0600).
 * @returns {Promise<string>} Ruta del archivo.
 */
export async function writeBackupFile(dir, name, content) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, name);
  await writeFile(path, content, { mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
  return path;
}

// Sin uid en su documento, se busca en Authentication (A-30). Si no se puede consultar (A-19), el script
// se niega: no podría saber si la persona tiene tareas.
async function resolveUid(store, target, projectId) {
  if (target.uid) return { uid: target.uid, fromAuth: false };
  let account;
  try {
    account = await store.findAccountByEmail(target.email);
  } catch (error) {
    throw new Refusal(
      `${explainError(error, projectId, 'consultar Authentication')}\nSin su uid no se sabe si tiene tareas (A-19). ` +
        'Reactívala en la página Usuarios, pídele que entre una vez en LUCAS (registra su uid), desactívala de ' +
        'nuevo y repite respaldar.',
    );
  }
  return { uid: account?.uid ?? null, fromAuth: Boolean(account) };
}

// Congelación (2.1, decisión 5): en el respaldo, las tareas de la persona y sus índices deben ser los
// mismos; es el conjunto que la página borrará por el índice.
function frozenTaskCount(content, uid) {
  if (!uid) return 0;
  const ownedBy = (name) => (content.colecciones[name] ?? []).filter((doc) => doc.datos.ownerId === uid);
  const tasks = ownedBy('tasks').map((doc) => doc.id);
  const index = new Set(ownedBy('taskIndex').map((doc) => doc.id));
  if (tasks.length !== index.size || tasks.some((id) => !index.has(id))) {
    throw new Refusal(
      'En el respaldo, el índice de la persona no coincide con sus tareas (¿alguien escribió mientras tanto?). ' +
        'No se creó el marcador: repite respaldar.',
    );
  }
  return tasks.length;
}

/**
 * Respaldo completo del ambiente, cifrado en un archivo nuevo y verificado: se descifra lo escrito en el
 * disco y se compara con lo leído.
 * @param {CommandContext} context
 * @param {string} passphrase
 */
async function writeVerifiedBackup({ options, projectId, store, log, now, backupDir, kdf }, passphrase) {
  const { plaintext, documentCount } = serializeBackup(await store.readAll(), {
    projectId,
    ambiente: options.ambiente,
    now: now(),
  });
  const hash = fingerprint(plaintext);
  const path = await writeBackupFile(
    join(backupDir, options.ambiente),
    backupFileName(options.ambiente, now()),
    encryptBackup(plaintext, passphrase, kdf),
  );
  const content = verifyBackup(await readFile(path, 'utf8'), passphrase, { hash, documentCount });
  log(`✔ Respaldo cifrado y verificado: ${documentCount} documentos, sha256 ${hash}`);
  log(`  ${path}`);
  return { content, documentCount, hash };
}

// Simulación: cuántos documentos tendría el respaldo completo, por colección.
async function logBackupSize(store, log) {
  const counts = await store.countAll();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const detail = Object.entries(counts).map(([name, n]) => `${name} ${n}`);
  log(`El respaldo completo tendría ${total} documentos (${detail.join(', ')}).`);
}

/**
 * respaldar: con --correo prepara la eliminación de esa persona; sin él, solo respalda el ambiente.
 * @param {CommandContext} context
 */
export function backup(context) {
  return context.options.correo ? backupUser(context) : backupEnvironment(context);
}

/**
 * Respaldo previo a un cambio de reglas (2.16): todo el ambiente, sin tocar índices ni marcadores.
 * @param {CommandContext} context
 */
export async function backupEnvironment(context) {
  const { store, terminal, log } = context;
  const admin = await requireAdmin(store, context.options.admin);
  log('Respaldo completo del ambiente: no toca índices ni crea marcadores de eliminación.');
  if (!context.options.aplicar) {
    await logBackupSize(store, log);
    return simulated(log);
  }

  await confirmWrite(context);
  const passphrase = await askNewPassphrase(terminal);
  const { documentCount } = await writeVerifiedBackup(context, passphrase);
  await store.commit([logOp(store, 'backup', admin.uid, null, { documentCount, scope: 'environment' })]);
  log('✔ Entrada en adminLog. Guarda la frase en el gestor de contraseñas: sin ella no se puede leer.');
  return 0;
}

/** @param {CommandContext} context */
export async function backupUser(context) {
  const { options, projectId, store, terminal, log, now } = context;
  const admin = await requireAdmin(store, options.admin);
  const email = normalizeEmail(options.correo);
  const data = await store.get('allowedUsers', email);
  if (!data) throw new Refusal(`${maskEmail(email)} no está en allowedUsers de este ambiente.`);
  const target = userFromData(email, data);
  const check = canChangeUser(admin, target, { type: 'delete' });
  if (!check.ok) throw new Refusal(REFUSALS[check.reason] ?? `No se puede respaldar a esa persona (${check.reason}).`);

  const { uid, fromAuth } = await resolveUid(store, target, projectId);
  const key = uid ?? email;
  const marker = await store.get('deletions', key);
  if (marker?.state === 'deleting') {
    throw new Refusal('La eliminación de esa persona ya está confirmada: reanúdala en la página Usuarios.');
  }
  // Primero el índice y después las tareas, como en verificar-indice (A-25).
  const index = uid ? await store.listOwners('taskIndex', uid) : [];
  const tasks = uid ? await store.listOwners('tasks', uid) : [];
  const diff = indexDiff(tasks, index);

  log(`Persona: ${maskEmail(email)} · desactivada · miembro`);
  if (!uid) log('Sin uid ni cuenta en Authentication: nunca entró. El marcador usará su correo y no hay tareas.');
  else log(`uid: ${uid}${fromAuth ? ' (de Authentication; se registrará en su documento)' : ''}`);
  log(
    `Tareas: ${tasks.length} · índices que faltan: ${diff.missing.length} · índices huérfanos: ${diff.orphans.length}`,
  );
  if (marker) log('Ya tiene un respaldo listo: se reemplazará por este.');

  if (!options.aplicar) {
    await logBackupSize(store, log);
    return simulated(log);
  }

  await confirmWrite(context);
  const passphrase = await askNewPassphrase(terminal);

  // 1. uid e índice de la persona, para que el respaldo ya los incluya.
  const ops = [
    ...(fromAuth ? [{ type: 'update', collection: 'allowedUsers', id: email, data: { uid } }] : []),
    ...indexRepairOps(diff),
  ];
  const written = { indexCreated: diff.missing.length, indexRemoved: diff.orphans.length, uidRegistered: fromAuth };
  try {
    await commitInChunks(store, ops);
    if (ops.length > 0) log(`✔ uid e índice al día (${ops.length} escrituras).`);

    // 2 y 3. Respaldo completo, cifrado en un archivo nuevo, y su verificación.
    const { content, documentCount, hash } = await writeVerifiedBackup(context, passphrase);
    const taskCount = frozenTaskCount(content, uid);

    // 4. Marcador y entrada del registro, en el mismo lote.
    await store.commit([
      {
        type: 'set',
        collection: 'deletions',
        id: key,
        data: { state: 'backup-ready', taskCount, backupAt: now(), backupHash: hash },
      },
      logOp(store, 'backup', admin.uid, uid, { taskCount, documentCount, ...written }),
    ]);
    log(`✔ Eliminación habilitada durante 24 horas: ${taskCount} tareas por borrar. Vuelve a la página Usuarios.`);
    return 0;
  } catch (error) {
    // Lo que se intentó escribir antes del fallo queda en el registro (2.7).
    if (ops.length > 0) {
      await logFailure(store, logOp(store, 'backup', admin.uid, uid, { completed: false, ...written }), log);
    }
    throw error;
  }
}
