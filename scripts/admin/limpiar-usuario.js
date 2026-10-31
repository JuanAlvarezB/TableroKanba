// Comando limpiar-usuario (PBI-2.10; docs/PLAN_USUARIOS.md, 2.5 y 2.11): borra las tareas y los índices
// que queden de una persona eliminada o en eliminación confirmada. Nunca los de alguien autorizado: se
// niega si algún documento de allowedUsers tiene ese uid sin estar en eliminación (decisión del 27 de
// octubre de 2026: así sirve también durante la eliminación, cuando la página pide limpiar los restos).
import { userFromData } from '../../src/domain/entities/User.js';
import { normalizeEmail } from '../../src/domain/rules/permissions.js';
import { Refusal, commitWithLog, confirmWrite, requireAdmin, simulated } from './context.js';

const NOT_ALLOWED = 'limpiar-usuario no borra datos de nadie autorizado.';

// Comprueba que el uid no es de una persona autorizada. Un documento sin uid registrado podría ser de la
// dueña de ese uid (entró antes del registro del uid, A-30): se mira su cuenta en Authentication y, si no
// se puede consultar (A-19), se exige que no haya personas autorizadas sin uid.
async function checkNoAuthorizedOwner(store, uid) {
  const users = (await store.listUsers()).map(({ email, data }) => userFromData(email, data));
  const holders = users.filter((user) => user.uid === uid);
  if (holders.some((user) => !user.deleting)) {
    throw new Refusal(`Una persona de allowedUsers tiene ese uid y no está en eliminación: ${NOT_ALLOWED}`);
  }
  if (holders.length > 0 && (await store.get('deletions', uid))?.state !== 'deleting') {
    throw new Refusal(
      'La persona con ese uid no tiene la eliminación confirmada: confírmala primero en la página Usuarios.',
    );
  }

  let account = null;
  try {
    account = await store.findAccountByUid(uid);
  } catch {
    const unregistered = users.filter((user) => !user.uid && !user.deleting).length;
    if (unregistered > 0) {
      throw new Refusal(
        `No se pudo consultar Authentication (A-19) y hay ${unregistered} personas autorizadas sin uid registrado: ` +
          'ese uid podría ser de una de ellas. Pídeles que entren una vez y repite el comando.',
      );
    }
  }
  const owner = account && users.find((user) => user.email === normalizeEmail(account.email));
  if (owner && !owner.deleting) throw new Refusal(`Ese uid es la cuenta de una persona autorizada: ${NOT_ALLOWED}`);
}

/** @param {import('./context.js').CommandContext} context */
export async function purgeUser(context) {
  const { options, store, log } = context;
  const admin = await requireAdmin(store, options.admin);
  const { uid } = options;
  if (uid === admin.uid) throw new Refusal(`Ese uid es el tuyo: ${NOT_ALLOWED}`);
  await checkNoAuthorizedOwner(store, uid);

  const index = await store.listOwners('taskIndex', uid);
  const tasks = await store.listOwners('tasks', uid);
  log(`Restos del uid ${uid}: ${tasks.length} tareas · ${index.length} documentos de taskIndex`);
  if (tasks.length === 0 && index.length === 0) {
    log('✔ No quedan tareas ni índices de ese uid.');
    return 0;
  }
  log('El borrado es irreversible: comprueba que existe un respaldo que incluya estas tareas.');
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  const ops = [
    ...tasks.map(({ id }) => ({ type: 'delete', collection: 'tasks', id })),
    ...index.map(({ id }) => ({ type: 'delete', collection: 'taskIndex', id })),
  ];
  const detail = { tasks: tasks.length, index: index.length };
  await commitWithLog(store, ops, { action: 'purge-leftovers', actorUid: admin.uid, targetUid: uid, detail }, log);
  log(`✔ Borradas ${tasks.length} tareas y ${index.length} índices.`);
  return 0;
}
