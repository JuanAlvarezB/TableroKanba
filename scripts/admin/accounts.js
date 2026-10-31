// Cuentas de Authentication y correos en la salida del script: lógica pura. La terminal nunca muestra un
// correo completo de otra persona (docs/PLAN_USUARIOS.md, 2.11).
import { normalizeEmail } from '../../src/domain/rules/permissions.js';

const keep = (text) => (text.length <= 4 ? 1 : 2);

/**
 * Correo enmascarado: las primeras letras del usuario y del dominio, y la terminación.
 * persona.prueba@ejemplo.test → pe***@e***.test
 * @param {string | null | undefined} email
 */
export function maskEmail(email) {
  const text = normalizeEmail(email);
  const at = text.lastIndexOf('@');
  if (at <= 0) return text ? '***' : '(sin correo)';
  const user = text.slice(0, at);
  const domain = text.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const ending = dot > 0 ? domain.slice(dot) : '';
  return `${user.slice(0, keep(user))}***@${name.slice(0, 1)}***${ending}`;
}

/**
 * @typedef {object} Account Cuenta de Authentication.
 * @property {string} uid
 * @property {string | null} email
 * @property {boolean} disabled
 * @property {string | null} createdAt
 * @property {string | null} lastSignInAt
 */

/**
 * Cuentas huérfanas: ni su correo es un documento de allowedUsers ni su uid está registrado en
 * alguno. Las que siguen en allowedUsers (también las que están en eliminación) no lo son.
 * @param {Account[]} accounts
 * @param {{ email: string, uid: string | null }[]} users Personas de allowedUsers.
 * @returns {Account[]}
 */
export function orphanAccounts(accounts, users) {
  const emails = new Set(users.map((user) => user.email));
  const uids = new Set(users.map((user) => user.uid).filter(Boolean));
  return accounts.filter((account) => !uids.has(account.uid) && !emails.has(normalizeEmail(account.email)));
}
