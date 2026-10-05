// Error de cualquier repositorio, independiente de Firebase. La interfaz decide qué mensaje
// mostrar según `reason`; el error original queda en `cause` para la consola.

/** @typedef {'permission-denied' | 'not-found' | 'unavailable'} RepositoryErrorReason */

export class RepositoryError extends Error {
  /**
   * @param {RepositoryErrorReason} reason
   * @param {unknown} [cause]
   */
  constructor(reason, cause) {
    super(cause instanceof Error ? cause.message : reason, { cause });
    this.name = 'RepositoryError';
    this.reason = reason;
  }
}
