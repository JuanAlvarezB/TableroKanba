import { describe, expect, it } from 'vitest';
import { maskEmail, orphanAccounts } from './accounts.js';
import { BACKUP_RETENTION_DAYS, LOG_RETENTION_MONTHS, ageInDays, classifyBackups, logCutoff } from './retention.js';
import { indexDiff, indexRepairOps, isIndexComplete } from './taskIndex.js';

const DAY = 24 * 60 * 60 * 1000;

describe('enmascarado de correos', () => {
  it.each([
    ['persona.prueba@ejemplo.test', 'pe***@e***.test'],
    ['  Persona.Prueba@Ejemplo.TEST ', 'pe***@e***.test'],
    ['ana@correo.example', 'a***@c***.example'],
    ['x@dominio.invalid', 'x***@d***.invalid'],
    ['nombre@sub.dominio.example', 'no***@s***.example'],
    ['raro@localhost', 'r***@l***'],
    ['sin-arroba', '***'],
    ['', '(sin correo)'],
    [null, '(sin correo)'],
  ])('%j → %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it('nunca deja ver el correo completo', () => {
    const email = 'nombre.completo@empresa-privada.test';
    expect(maskEmail(email)).not.toContain('nombre.completo');
    expect(maskEmail(email)).not.toContain('empresa-privada');
  });
});

describe('cuentas huérfanas de Authentication', () => {
  const account = (uid, email) => ({ uid, email, disabled: false, createdAt: null, lastSignInAt: null });
  const users = [
    { email: 'autorizada@ejemplo.test', uid: 'u1' },
    { email: 'nunca-entro@ejemplo.test', uid: null },
    { email: 'cambio-de-correo@ejemplo.test', uid: 'u3' },
  ];

  it('son las que no tienen documento por correo ni por uid', () => {
    const accounts = [
      account('u1', 'autorizada@ejemplo.test'),
      account('u2', 'Nunca-Entro@Ejemplo.test'),
      account('u3', 'otro-correo@ejemplo.test'),
      account('u4', 'eliminada@ejemplo.test'),
      account('u5', null),
    ];
    expect(orphanAccounts(accounts, users).map((a) => a.uid)).toEqual(['u4', 'u5']);
  });
});

describe('vencimientos', () => {
  it(`el registro se conserva ${LOG_RETENTION_MONTHS} meses de calendario`, () => {
    expect(logCutoff(Date.UTC(2026, 9, 27, 15, 30))).toEqual(new Date(Date.UTC(2025, 9, 27, 15, 30)));
    expect(logCutoff(Date.UTC(2027, 0, 31))).toEqual(new Date(Date.UTC(2026, 0, 31)));
  });

  it('el 29 de febrero pasa al último día de febrero del año anterior', () => {
    expect(logCutoff(Date.UTC(2028, 1, 29, 8))).toEqual(new Date(Date.UTC(2027, 1, 28, 8)));
  });

  it('cuenta los días completos', () => {
    const now = Date.UTC(2026, 9, 27, 12);
    expect(ageInDays(now - 30 * DAY, now)).toBe(30);
    expect(ageInDays(now - 30 * DAY + 1, now)).toBe(29);
  });

  it(`un respaldo vence cuando tiene más de ${BACKUP_RETENTION_DAYS} días; los demás archivos no se tocan`, () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const names = [
      'respaldo-dev-2026-09-27T12-00-00Z.cifrado', // justo 30 días
      'respaldo-dev-2026-09-27T11-59-59Z.cifrado', // un segundo más
      'respaldo-dev-2026-10-26T09-00-00Z.cifrado',
      'respaldo-pdn-2026-01-01T00-00-00Z.cifrado', // de otro ambiente
      '.DS_Store',
    ];
    const { backups, ignored } = classifyBackups(names, 'dev', now);
    expect(backups.map(({ name, expired }) => [name, expired])).toEqual([
      ['respaldo-dev-2026-09-27T11-59-59Z.cifrado', true],
      ['respaldo-dev-2026-09-27T12-00-00Z.cifrado', false],
      ['respaldo-dev-2026-10-26T09-00-00Z.cifrado', false],
    ]);
    expect(ignored).toEqual(['respaldo-pdn-2026-01-01T00-00-00Z.cifrado', '.DS_Store']);
  });
});

describe('tareas e índice', () => {
  const tasks = [
    { id: 't1', ownerId: 'u1' },
    { id: 't2', ownerId: 'u1' },
    { id: 't3', ownerId: 'u2' },
    { id: 't4', ownerId: undefined },
  ];

  it('detecta tareas sin índice, índices huérfanos, dueños distintos y tareas sin dueño', () => {
    const index = [
      { id: 't1', ownerId: 'u1' },
      { id: 't3', ownerId: 'u1' },
      { id: 'borrada', ownerId: 'u2' },
    ];
    const diff = indexDiff(tasks, index);
    expect(diff).toEqual({
      missing: [{ id: 't2', ownerId: 'u1' }],
      orphans: [{ id: 'borrada' }],
      mismatched: [{ id: 't3', ownerId: 'u2' }],
      unowned: [{ id: 't4' }],
    });
    expect(isIndexComplete(diff)).toBe(false);
    expect(indexRepairOps(diff)).toEqual([
      { type: 'set', collection: 'taskIndex', id: 't2', data: { ownerId: 'u1' } },
      { type: 'set', collection: 'taskIndex', id: 't3', data: { ownerId: 'u2' } },
      { type: 'delete', collection: 'taskIndex', id: 'borrada' },
    ]);
  });

  it('el índice está completo cuando cada tarea con dueño tiene el suyo y no sobra ninguno', () => {
    const owned = tasks.slice(0, 3);
    const diff = indexDiff(owned, owned);
    expect(isIndexComplete(diff)).toBe(true);
    expect(indexRepairOps(diff)).toEqual([]);
  });
});
