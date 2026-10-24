// Huella y comparación de reglas de Firestore: lógica pura, sin Firebase (docs/PLAN_USUARIOS.md, 1.12).
import { createHash } from 'node:crypto';

/** Huella SHA-256 (hexadecimal) de un texto. */
export function fingerprint(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Solo quita lo que no cambia el significado de las reglas: saltos de línea de Windows y espacios
// al final de cada línea y del archivo (la consola de Firebase puede alterarlos al editar).
function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

function firstDifference(local, published) {
  const localLines = local.split('\n');
  const publishedLines = published.split('\n');
  const total = Math.max(localLines.length, publishedLines.length);
  for (let i = 0; i < total; i += 1) {
    if (localLines[i] !== publishedLines[i]) {
      return { line: i + 1, local: localLines[i] ?? null, published: publishedLines[i] ?? null };
    }
  }
  return null;
}

/**
 * Compara el archivo local con las reglas publicadas.
 * - 'identical': mismo texto, byte a byte.
 * - 'whitespace': solo cambian espacios al final o los saltos de línea; las reglas son las mismas.
 * - 'different': las reglas no son las mismas; firstDifference indica la primera línea distinta.
 * @param {string} local
 * @param {string} published
 */
export function compareRules(local, published) {
  const localHash = fingerprint(local);
  const publishedHash = fingerprint(published);
  if (localHash === publishedHash) return { status: 'identical', localHash, publishedHash, firstDifference: null };

  const [a, b] = [normalize(local), normalize(published)];
  if (a === b) return { status: 'whitespace', localHash, publishedHash, firstDifference: null };
  return { status: 'different', localHash, publishedHash, firstDifference: firstDifference(a, b) };
}
