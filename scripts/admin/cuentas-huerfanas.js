// Comando cuentas-huerfanas (PBI-2.10; docs/PLAN_USUARIOS.md, 2.5 y 2.11; alarma A-26): lista las
// cuentas de Authentication sin documento en allowedUsers, con el correo enmascarado, y con --aplicar
// borra las que se confirmen una por una. Si las credenciales de Google no alcanzan para Authentication
// (A-19), la limpieza es manual en la consola.
import { userFromData } from '../../src/domain/entities/User.js';
import { maskEmail, orphanAccounts } from './accounts.js';
import { explainError } from './cli.js';
import { Refusal, commitWithLog, confirmWrite, requireAdmin, simulated } from './context.js';

const day = (text) => (text ? new Date(text).toISOString().slice(0, 10) : 'nunca');

/** @param {import('./context.js').CommandContext} context */
export async function cleanOrphanAccounts(context) {
  const { options, projectId, store, terminal, log } = context;
  const admin = await requireAdmin(store, options.admin);
  let accounts;
  try {
    accounts = await store.listAccounts();
  } catch (error) {
    throw new Refusal(
      `${explainError(error, projectId, 'listar las cuentas de Authentication')}\nLa limpieza es manual (A-19): ` +
        'Authentication → Users, comparando con allowedUsers (ALTA_USUARIO_LUCAS.md, «Limpieza de la cuenta huérfana»).',
    );
  }
  const users = (await store.listUsers()).map(({ email, data }) => userFromData(email, data));
  const orphans = orphanAccounts(accounts, users);
  log(`Cuentas en Authentication: ${accounts.length} · huérfanas (sin documento en allowedUsers): ${orphans.length}`);
  if (orphans.length === 0) {
    log('✔ No hay cuentas huérfanas.');
    return 0;
  }

  // Tareas que todavía tenga cada cuenta: borrar la cuenta no las borra (para eso, limpiar-usuario).
  const owned = new Map();
  for (const { ownerId } of await store.listOwners('tasks')) owned.set(ownerId, (owned.get(ownerId) ?? 0) + 1);
  for (const account of orphans) {
    const tasks = owned.get(account.uid) ?? 0;
    log(
      `  ${maskEmail(account.email)} · uid ${account.uid} · creada ${day(account.createdAt)} · ` +
        `último acceso ${day(account.lastSignInAt)}${account.disabled ? ' · deshabilitada' : ''}` +
        `${tasks ? ` · ⚠ ${tasks} tareas (limpiar-usuario)` : ''}`,
    );
  }
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  let deleted = 0;
  for (const account of orphans) {
    const answer = await terminal.ask(
      `¿Borrar la cuenta ${maskEmail(account.email)} (uid ${account.uid})? Escribe "borrar" o pulsa Enter para saltarla: `,
    );
    if (answer.trim().toLowerCase() !== 'borrar') {
      log('  Saltada.');
      continue;
    }
    await store.deleteAccount(account.uid);
    deleted += 1;
    // Una entrada por cuenta: targetUid es uno solo. Si no se puede registrar, no se borra ninguna más.
    await commitWithLog(store, [], { action: 'clean-auth', actorUid: admin.uid, targetUid: account.uid }, log);
    log('  ✔ Borrada.');
  }
  log(`Cuentas borradas: ${deleted} de ${orphans.length}.`);
  return 0;
}
