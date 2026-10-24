// Conexión del script con Firebase (Admin SDK) usando las credenciales de Google de quien lo ejecuta
// (gcloud auth application-default login). Nunca archivos de llave (docs/PLAN_USUARIOS.md, 2.11).
import { applicationDefault, initializeApp } from 'firebase-admin/app';

/**
 * @param {string} projectId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function connect(projectId, env = process.env) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'El script no usa archivos de llave: quita GOOGLE_APPLICATION_CREDENTIALS y usa gcloud auth application-default login.',
    );
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}
