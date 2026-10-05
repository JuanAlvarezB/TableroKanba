// Traduce los errores de Firestore a RepositoryError.
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';

// permission-denied: las reglas de seguridad rechazaron la operación.
// not-found: el documento ya no existe (otro dispositivo lo borró).
// Cualquier otro código se trata como servidor no disponible (sin conexión, cuota…).
const REASONS = { 'permission-denied': 'permission-denied', 'not-found': 'not-found' };

export function toRepositoryError(error) {
  if (error instanceof RepositoryError) return error;
  return new RepositoryError(REASONS[error?.code] ?? 'unavailable', error);
}
