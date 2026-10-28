// Comando limpiar-respaldos (PBI-2.10; docs/PLAN_USUARIOS.md, 2.11; alarma A-21): borra de este equipo los
// respaldos del ambiente con más de 30 días. No se conecta a Firebase ni escribe en adminLog: solo
// trabaja con la carpeta local. Las copias hechas en otro lugar se borran a mano.
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { confirmWrite, formatTime, simulated } from './context.js';
import { BACKUP_RETENTION_DAYS, classifyBackups } from './retention.js';

/** @param {import('./context.js').CommandContext} context */
export async function purgeBackups(context) {
  const { options, log, now, backupDir } = context;
  const dir = join(backupDir, options.ambiente);
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    log(`No hay respaldos de este ambiente (${dir} no existe).`);
    return 0;
  }

  const { backups, ignored } = classifyBackups(names, options.ambiente, now());
  log(`Carpeta: ${dir}`);
  backups.forEach(({ name, createdAt, days, expired }) =>
    log(`  ${name} · ${formatTime(createdAt)} · ${days} días${expired ? ' · vencido' : ''}`),
  );
  if (ignored.length > 0) log(`Otros archivos (no se tocan): ${ignored.length}`);
  const expired = backups.filter((backup) => backup.expired);
  log(`Respaldos con más de ${BACKUP_RETENTION_DAYS} días: ${expired.length}`);
  if (expired.length === 0) {
    log('✔ No hay respaldos vencidos.');
    return 0;
  }
  if (!options.aplicar) return simulated(log);

  await confirmWrite(context);
  for (const { name } of expired) await rm(join(dir, name));
  log(`✔ Borrados ${expired.length} respaldos. Si copiaste alguno a otro lugar, bórralo también allí.`);
  return 0;
}
