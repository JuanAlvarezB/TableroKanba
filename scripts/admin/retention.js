// Plazos de conservación (docs/PLAN_USUARIOS.md, 2.7 y 2.11; alarmas A-20 y A-21): lógica pura. Son
// propuestas pendientes de la revisión legal (PBI-2.13); si cambian, se cambian solo aquí.
import { parseBackupFileName } from './backup.js';

export const LOG_RETENTION_MONTHS = 12;
export const BACKUP_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hora límite del registro: las entradas anteriores tienen más de 12 meses. Se cuentan meses de
 * calendario (UTC); si el día no existe en el mes de destino (29 de febrero), se toma su último día.
 * @param {number} now
 * @returns {Date}
 */
export function logCutoff(now) {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - LOG_RETENTION_MONTHS);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

/** Días completos transcurridos desde createdAt. */
export const ageInDays = (createdAt, now) => Math.floor((now - createdAt) / DAY_MS);

/**
 * Respaldos del ambiente con más de 30 días, según la fecha de su nombre (copiar el archivo cambia su
 * fecha de modificación, no su nombre). Los archivos que no son respaldos de este ambiente no se tocan.
 * @param {string[]} names Archivos de la carpeta de respaldos del ambiente.
 * @param {'dev' | 'pdn'} ambiente
 * @param {number} now
 */
export function classifyBackups(names, ambiente, now) {
  const backups = [];
  const ignored = [];
  for (const name of names) {
    const parsed = parseBackupFileName(name);
    if (parsed?.ambiente !== ambiente) {
      ignored.push(name);
      continue;
    }
    const days = ageInDays(parsed.createdAt, now);
    backups.push({
      name,
      createdAt: parsed.createdAt,
      days,
      expired: now - parsed.createdAt > BACKUP_RETENTION_DAYS * DAY_MS,
    });
  }
  backups.sort((a, b) => a.createdAt - b.createdAt);
  return { backups, ignored };
}
