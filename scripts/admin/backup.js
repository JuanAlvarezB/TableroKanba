// Respaldo completo del ambiente (docs/PLAN_USUARIOS.md, 2.5 y 2.11): serialización, cifrado y
// verificación. Lógica pura, sin Firebase. El archivo contiene los datos de todas las personas del
// ambiente, incluidos los historiales de las tareas (A-18, A-47): por eso solo existe cifrado.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { fingerprint } from './rules.js';

const FORMAT = 'lucas-respaldo';
const ENCRYPTED_FORMAT = 'lucas-respaldo-cifrado';
const VERSION = 1;
const CIPHER = 'aes-256-gcm';
const TYPE_KEY = '__tipo';

export const MIN_PASSPHRASE_LENGTH = 12;

// scrypt con N = 2^17 (unos 128 MB de memoria y menos de un segundo por intento): encarece probar
// frases por fuerza bruta si el archivo se filtra. Los parámetros viajan en el archivo.
export const KDF_DEFAULTS = { N: 2 ** 17, r: 8, p: 1 };
const KDF_MAX_N = 2 ** 20;

/** Error de un respaldo que no se puede leer o no coincide con lo esperado. */
export class BackupError extends Error {}

/* ---------- Valores de Firestore ---------- */

const isTimestamp = (value) =>
  typeof value?.toMillis === 'function' && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds);

// Convierte un valor de Firestore a JSON sin perder su tipo. Solo hay los tipos que usa LUCAS: textos,
// números, booleanos, null, listas, mapas y marcas de tiempo del servidor. Cualquier otro detiene el
// respaldo (mejor fallar que restaurar algo distinto); el mensaje nombra el campo, nunca su valor.
function encodeValue(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BackupError(`Número no representable en ${path}.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => encodeValue(item, `${path}.${i}`));
  if (isTimestamp(value)) return { [TYPE_KEY]: 'timestamp', s: value.seconds, n: value.nanoseconds };
  if (Object.getPrototypeOf(value) === Object.prototype) {
    if (TYPE_KEY in value) throw new BackupError(`Campo reservado ${TYPE_KEY} en ${path}.`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item, `${path}.${key}`)]));
  }
  throw new BackupError(`Tipo de dato no soportado en ${path}.`);
}

/**
 * @param {unknown} value Valor guardado con encodeValue.
 * @param {(seconds: number, nanoseconds: number) => unknown} makeTimestamp Crea la marca de tiempo
 *   (en el script, Timestamp del Admin SDK).
 */
export function decodeValue(value, makeTimestamp) {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, makeTimestamp));
  if (value === null || typeof value !== 'object') return value;
  if (value[TYPE_KEY] === 'timestamp') return makeTimestamp(value.s, value.n);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item, makeTimestamp)]));
}

/* ---------- Contenido del respaldo ---------- */

/**
 * @typedef {{ id: string, data: Record<string, unknown> }} StoredDocument
 * @typedef {Record<string, StoredDocument[]>} Collections Documentos por colección.
 * @typedef {object} BackupContent
 * @property {string} formato
 * @property {number} version
 * @property {string} proyecto
 * @property {'dev' | 'pdn'} ambiente
 * @property {number} creado Milisegundos.
 * @property {Record<string, { id: string, datos: unknown }[]>} colecciones
 */

/**
 * Texto del respaldo: colecciones y documentos ordenados, para que la huella no dependa del orden
 * en que llegan.
 * @param {Collections} collections
 * @param {{ projectId: string, ambiente: 'dev' | 'pdn', now: number }} meta
 * @returns {{ plaintext: string, documentCount: number }}
 */
export function serializeBackup(collections, { projectId, ambiente, now }) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const colecciones = Object.fromEntries(
    Object.keys(collections)
      .sort()
      .map((name) => [
        name,
        [...collections[name]].sort(byId).map(({ id, data }) => ({ id, datos: encodeValue(data, `${name}/${id}`) })),
      ]),
  );
  /** @type {BackupContent} */
  const content = { formato: FORMAT, version: VERSION, proyecto: projectId, ambiente, creado: now, colecciones };
  return { plaintext: JSON.stringify(content), documentCount: countDocuments(content) };
}

/** @param {BackupContent} content */
export function countDocuments(content) {
  return Object.values(content.colecciones).reduce((total, docs) => total + docs.length, 0);
}

/** @param {string} plaintext */
export function parseBackup(plaintext) {
  const content = JSON.parse(plaintext);
  if (content?.formato !== FORMAT || content.version !== VERSION || typeof content.colecciones !== 'object') {
    throw new BackupError('El archivo no es un respaldo de LUCAS de esta versión.');
  }
  return /** @type {BackupContent} */ (content);
}

/* ---------- Cifrado ---------- */

function deriveKey(passphrase, salt, { N, r, p }) {
  return scryptSync(passphrase.normalize('NFC'), salt, 32, { N, r, p, maxmem: 256 * N * r });
}

// La cabecera viaja en claro (no tiene datos de nadie) y va autenticada: cambiarla invalida el archivo.
const headerOf = ({ formato, version, kdf, cifrado, iv }) => JSON.stringify({ formato, version, kdf, cifrado, iv });

/**
 * Cifra el texto del respaldo con AES-256-GCM y una clave derivada de la frase (scrypt), con sal e IV
 * aleatorios en cada archivo.
 * @param {string} plaintext
 * @param {string} passphrase
 * @param {{ N: number, r: number, p: number }} [kdf]
 * @returns {string} Contenido del archivo (JSON).
 */
export function encryptBackup(plaintext, passphrase, kdf = KDF_DEFAULTS) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const envelope = {
    formato: ENCRYPTED_FORMAT,
    version: VERSION,
    kdf: { nombre: 'scrypt', ...kdf, sal: salt.toString('base64') },
    cifrado: CIPHER,
    iv: iv.toString('base64'),
  };
  const cipher = createCipheriv(CIPHER, deriveKey(passphrase, salt, kdf), iv);
  cipher.setAAD(Buffer.from(headerOf(envelope)));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({
    ...envelope,
    etiqueta: cipher.getAuthTag().toString('base64'),
    datos: data.toString('base64'),
  });
}

/**
 * @param {string} fileContent
 * @param {string} passphrase
 * @returns {string} Texto del respaldo.
 */
export function decryptBackup(fileContent, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(fileContent);
  } catch {
    throw new BackupError('El archivo no es un respaldo cifrado de LUCAS.');
  }
  const { formato, version, kdf, cifrado, iv, etiqueta, datos } = envelope ?? {};
  if (formato !== ENCRYPTED_FORMAT || version !== VERSION || cifrado !== CIPHER || kdf?.nombre !== 'scrypt') {
    throw new BackupError('El archivo no es un respaldo cifrado de LUCAS de esta versión.');
  }
  // Un archivo manipulado no puede pedir una derivación desmesurada.
  if (!Number.isInteger(kdf.N) || kdf.N > KDF_MAX_N || kdf.r > 32 || kdf.p > 4) {
    throw new BackupError('Los parámetros de cifrado del archivo no son válidos.');
  }
  try {
    const key = deriveKey(passphrase, Buffer.from(kdf.sal, 'base64'), kdf);
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(headerOf(envelope)));
    decipher.setAuthTag(Buffer.from(etiqueta, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(datos, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new BackupError('No se pudo descifrar: la frase no es correcta o el archivo está dañado.');
  }
}

/**
 * Verificación antes de crear el marcador (2.11): el archivo escrito se descifra y debe tener la
 * misma huella SHA-256 y el mismo número de documentos que lo leído de Firestore.
 * @param {string} fileContent
 * @param {string} passphrase
 * @param {{ hash: string, documentCount: number }} expected
 * @returns {BackupContent}
 */
export function verifyBackup(fileContent, passphrase, expected) {
  const plaintext = decryptBackup(fileContent, passphrase);
  if (fingerprint(plaintext) !== expected.hash) {
    throw new BackupError('La huella del respaldo escrito no coincide con lo leído.');
  }
  const content = parseBackup(plaintext);
  if (countDocuments(content) !== expected.documentCount) {
    throw new BackupError('El respaldo escrito no tiene el mismo número de documentos que lo leído.');
  }
  return content;
}

/* ---------- Nombre del archivo ---------- */

const FILE_PATTERN = /^respaldo-(dev|pdn)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.cifrado$/;

/**
 * respaldo-<ambiente>-AAAA-MM-DDTHH-MM-SSZ.cifrado (hora UTC). No lleva el correo de nadie.
 * @param {'dev' | 'pdn'} ambiente
 * @param {number} now
 */
export function backupFileName(ambiente, now) {
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/:/g, '-');
  return `respaldo-${ambiente}-${stamp}Z.cifrado`;
}

/**
 * @param {string} name
 * @returns {{ ambiente: 'dev' | 'pdn', createdAt: number } | null} null si no es un respaldo.
 */
export function parseBackupFileName(name) {
  const match = FILE_PATTERN.exec(name);
  if (!match) return null;
  const [, ambiente, ...parts] = match;
  const [year, month, day, hours, minutes, seconds] = parts.map(Number);
  return { ambiente, createdAt: Date.UTC(year, month - 1, day, hours, minutes, seconds) };
}
