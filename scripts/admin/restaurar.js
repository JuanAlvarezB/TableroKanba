// Comando restaurar (PBI-2.12; docs/PLAN_USUARIOS.md, 2.5 y alarma A-17): vuelve a crear a una persona
// eliminada desde un respaldo cifrado: su documento de allowedUsers (desactivado), sus tareas con su
// historial y sus índices. Solo esa persona; el resto del ambiente no se toca. Nunca sobrescribe a alguien
// autorizado ni tareas de otra persona. Decisión del 27 de octubre de 2026 (TK-2.12.1: «comando restaurar»).
import { readFile } from 'node:fs/promises';
import { userFromData } from '../../src/domain/entities/User.js';
import { normalizeEmail } from '../../src/domain/rules/permissions.js';
import { maskEmail } from './accounts.js';
import { decodeValue, decryptBackup, parseBackup } from './backup.js';
import { Refusal, commitWithLog, confirmWrite, formatTime, requireAdmin, simulated } from './context.js';

/** @param {import('./context.js').CommandContext} context */
export async function restoreUser(context) {
  const { options, projectId, store, terminal, log } = context;
  const admin = await requireAdmin(store, options.admin);
  const email = normalizeEmail(options.correo);
  const passphrase = await terminal.askHidden('Frase de cifrado del respaldo: ');
  const content = parseBackup(decryptBackup(await readFile(options.archivo, 'utf8'), passphrase));
  if (content.proyecto !== projectId) {
    throw new Refusal(`El respaldo es de otro proyecto (${content.proyecto}): restáuralo en su mismo ambiente.`);
  }

  const saved = (content.colecciones.allowedUsers ?? []).find((doc) => doc.id === email);
  if (!saved) throw new Refusal(`El respaldo no tiene a ${maskEmail(email)}.`);
  const { deleting, ...user } = /** @type {Record<string, unknown>} */ (decodeValue(saved.datos, store.timestamp));
  const savedUid = userFromData(email, user).uid;
  // Si la cuenta de Authentication se borró y se volvió a crear, la persona tiene otro uid (--uid).
  const uid = options.uid ?? savedUid;
  const tasks = savedUid ? (content.colecciones.tasks ?? []).filter((doc) => doc.datos.ownerId === savedUid) : [];

  if (await store.get('allowedUsers', email)) {
    throw new Refusal(`${maskEmail(email)} ya está en allowedUsers: restaurar no sobrescribe a nadie.`);
  }
  for (const key of new Set([savedUid ?? email, uid ?? email])) {
    if (await store.get('deletions', key)) {
      throw new Refusal('Esa persona tiene un marcador de eliminación: termina o cancela la eliminación antes.');
    }
  }
  if (uid && (await store.listUsers()).some(({ data }) => data.uid === uid)) {
    throw new Refusal('Otra persona de allowedUsers tiene ese uid: no se restaura nada.');
  }
  // Las tareas que ya existen solo pueden ser de un intento anterior de esta misma restauración.
  const existing = await store.ownersOf(
    'tasks',
    tasks.map((doc) => doc.id),
  );
  if (existing.some((task) => task.ownerId !== uid)) {
    throw new Refusal('Alguna tarea del respaldo ya existe con otro dueño: no se restaura nada.');
  }

  log(`Respaldo del ${formatTime(content.creado)} · proyecto ${content.proyecto}`);
  log(
    `Persona: ${maskEmail(email)} · uid ${uid ?? '(sin uid: nunca entró)'}${uid !== savedUid ? ` (antes ${savedUid})` : ''}`,
  );
  const withHistory = tasks.filter((doc) => Array.isArray(doc.datos.history)).length;
  log(
    `Tareas: ${tasks.length} (con historial: ${withHistory}) · ya restauradas en un intento anterior: ${existing.length}`,
  );
  log('Se restaura desactivada: después, reactívala en la página Usuarios.');
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  const ops = [
    ...tasks.flatMap(({ id, datos }) => [
      { type: 'set', collection: 'tasks', id, data: { ...decodeValue(datos, store.timestamp), ownerId: uid } },
      { type: 'set', collection: 'taskIndex', id, data: { ownerId: uid } },
    ]),
    // El documento va al final: si algo falla antes, la persona sigue sin acceso y el comando se repite.
    { type: 'set', collection: 'allowedUsers', id: email, data: { ...user, ...(uid && { uid }), active: false } },
  ];
  const detail = { taskCount: tasks.length, backupAt: content.creado };
  await commitWithLog(store, ops, { action: 'restore', actorUid: admin.uid, targetUid: uid, detail }, log);
  log(`✔ Restaurada con ${tasks.length} tareas. Reactívala en la página Usuarios y pídele que entre.`);
  return 0;
}
