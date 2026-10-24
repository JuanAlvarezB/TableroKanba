// Comando verificar-reglas (PBI-1.7): compara las reglas de Firestore publicadas en el proyecto con
// firestore.rules. Solo lee; no cambia nada en Firebase.
import { compareRules } from './rules.js';

const DIFFERENT = 1;

/**
 * Texto de las reglas publicadas. Una publicación con la CLI de Firebase tiene un solo archivo.
 * @param {{ source: { name: string, content: string }[] }} ruleset
 */
export function publishedSource(ruleset) {
  if (ruleset.source.length !== 1) {
    throw new Error(`Las reglas publicadas tienen ${ruleset.source.length} archivos; se esperaba uno.`);
  }
  return ruleset.source[0].content;
}

/**
 * @param {object} deps
 * @param {{ getFirestoreRuleset: () => Promise<{ name: string, createTime: string, source: { name: string, content: string }[] }> }} deps.securityRules
 *   Servicio de reglas del Admin SDK (getSecurityRules(app)).
 * @param {string} deps.localRules Contenido de firestore.rules.
 * @param {string} deps.label Ambiente y proyecto, para el informe.
 * @param {(line: string) => void} deps.log
 * @returns {Promise<number>} Código de salida: 0 si coinciden, 1 si no.
 */
export async function verifyRules({ securityRules, localRules, label, log }) {
  const ruleset = await securityRules.getFirestoreRuleset();
  const result = compareRules(localRules, publishedSource(ruleset));

  log(`Proyecto: ${label}`);
  log(`Reglas publicadas: ${ruleset.name} (creadas el ${ruleset.createTime})`);
  log(`Huella publicada:   sha256 ${result.publishedHash}`);
  log(`Huella del archivo: sha256 ${result.localHash}`);

  if (result.status === 'identical') {
    log('✔ Coinciden: lo publicado es exactamente firestore.rules.');
    return 0;
  }
  if (result.status === 'whitespace') {
    log('✔ Coinciden: solo cambian espacios al final de línea o los saltos de línea; las reglas son las mismas.');
    return 0;
  }
  const { line, local, published } = result.firstDifference;
  log('✘ NO coinciden: lo publicado no es firestore.rules.');
  log(`  Primera diferencia en la línea ${line}:`);
  log(`  archivo:   ${local ?? '(no existe)'}`);
  log(`  publicado: ${published ?? '(no existe)'}`);
  return DIFFERENT;
}
