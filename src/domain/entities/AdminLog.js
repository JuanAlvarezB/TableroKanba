// Entrada del registro inmutable de acciones administrativas (docs/PLAN_USUARIOS.md, 2.7). Solo
// guarda uids, nunca correos, nombres ni contenido de tareas. La hora (at) la pone el servidor al
// escribirla, y firestore.rules exige que sea la de la propia petición.

/** @typedef {'authorize' | 'deactivate' | 'reactivate' | 'promote' | 'demote'} AdminAction */

/**
 * @typedef {object} LogEntry
 * @property {AdminAction} action
 * @property {string} actorUid uid de quien hace la acción.
 * @property {string | null} targetUid uid de la persona afectada, o null si nunca ha entrado.
 * @property {Record<string, string | number | boolean>} [detail] Mapa pequeño, por ejemplo
 *   { from: 'member', to: 'admin' }.
 *
 * @typedef {LogEntry & { id: string }} NewLogEntry Entrada con el ID de su documento, que el
 *   cambio guarda en lastChange.
 */

/**
 * @param {AdminAction} action
 * @param {string} actorUid
 * @param {string | null} targetUid
 * @param {Record<string, string | number | boolean>} [detail]
 * @returns {LogEntry}
 */
export function buildLogEntry(action, actorUid, targetUid, detail) {
  return { action, actorUid, targetUid: targetUid ?? null, ...(detail && { detail }) };
}
