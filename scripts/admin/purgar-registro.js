// Comando purgar-registro (PBI-2.10; docs/PLAN_USUARIOS.md, 2.7 y 2.11; alarma A-20): borra las entradas
// de adminLog de más de 12 meses. La propia purga queda registrada con una entrada nueva.
import { commitWithLog, confirmWrite, requireAdmin, simulated } from './context.js';
import { LOG_RETENTION_MONTHS, logCutoff } from './retention.js';

/** @param {import('./context.js').CommandContext} context */
export async function purgeLog(context) {
  const { options, store, log, now } = context;
  const admin = await requireAdmin(store, options.admin);
  const cutoff = logCutoff(now());
  const before = cutoff.toISOString().slice(0, 10);
  const ids = await store.logIdsBefore(cutoff);
  log(`Entradas de adminLog anteriores al ${before} (más de ${LOG_RETENTION_MONTHS} meses): ${ids.length}`);
  if (ids.length === 0) {
    log('✔ No hay entradas vencidas.');
    return 0;
  }
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  const ops = ids.map((id) => ({ type: 'delete', collection: 'adminLog', id }));
  const detail = { deleted: ids.length, before };
  await commitWithLog(store, ops, { action: 'purge-log', actorUid: admin.uid, targetUid: null, detail }, log);
  log(`✔ Borradas ${ids.length} entradas; la purga quedó registrada en adminLog.`);
  return 0;
}
