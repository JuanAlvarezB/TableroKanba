// Comando completar-indice (PBI-2.10; docs/PLAN_USUARIOS.md, 2.6 y 2.11): deja taskIndex completo para
// quien no ha vuelto a entrar (el tablero lo completa solo al entrar). Crea los índices que faltan,
// corrige el dueño de los que no coinciden y borra los huérfanos; nunca toca una tarea.
import { commitWithLog, confirmWrite, requireAdmin, simulated } from './context.js';
import { indexRepairOps } from './taskIndex.js';
import { readIndexState, reportIndexState } from './verificar-indice.js';

/** @param {import('./context.js').CommandContext} context */
export async function completeIndex(context) {
  const { options, store, log } = context;
  const admin = await requireAdmin(store, options.admin);
  const state = await readIndexState(store, options.uid);
  reportIndexState(log, state, options.uid);

  const { missing, mismatched, orphans } = state.diff;
  const ops = indexRepairOps(state.diff);
  if (ops.length === 0) {
    log('✔ No hay nada que completar.');
    return 0;
  }
  log(`Por escribir: crear ${missing.length} · corregir ${mismatched.length} · borrar ${orphans.length}.`);
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  const detail = { created: missing.length, fixed: mismatched.length, removed: orphans.length };
  await commitWithLog(
    store,
    ops,
    { action: 'backfill-index', actorUid: admin.uid, targetUid: options.uid ?? null, detail },
    log,
  );
  log(`✔ Índice completado (${ops.length} escrituras). Compruébalo con verificar-indice.`);
  return 0;
}
