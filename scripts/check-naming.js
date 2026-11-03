// Chequeo heurístico de nombres de la suite de aceptación (skill estandares-pruebas-automatizadas, A.5):
// palabras en español, caracteres no ASCII, nombres vagos, notación húngara y nombres numerados en los
// identificadores. Ignora literales y comentarios de línea; "naming-ignore" en una línea la excluye.
// Uso: node scripts/check-naming.js <carpeta> <extensión> [extensión...]
import fs from 'node:fs';
import path from 'node:path';

const [rootDirectory, ...extensions] = process.argv.slice(2);
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'build',
  'target',
  '.gradle',
  'playwright-report',
  'test-results',
]);
const SPANISH_WORDS = new Set([
  'boton', 'usuario', 'usuarios', 'curso', 'cursos', 'pagina', 'inscripcion', 'inscribir',
  'mensaje', 'correo', 'contrasena', 'clave', 'fecha', 'nombre', 'iniciar', 'sesion',
  'validar', 'seleccionar', 'obtener', 'crear', 'guardar', 'buscar', 'cerrar', 'abrir',
  'estudiante', 'estudiantes', 'ingresar', 'datos', 'tabla', 'lista', 'campo',
  'formulario', 'enviar', 'verificar', 'pantalla', 'prueba', 'pruebas',
]); // prettier-ignore
const VAGUE_NAMES = new Set(['data', 'info', 'temp', 'tmp', 'obj', 'aux', 'foo', 'bar', 'stuff', 'thing', 'misc']);
const HUNGARIAN_NOTATION = /^(str|int|lst|arr|obj|bool|num)[A-Z]/;
const NUMBERED_NAME = /^[a-z]+[0-9]+$/;
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7F]/;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

let findingsCount = 0;

function report(file, lineNumber, rule, detail) {
  findingsCount += 1;
  console.log(`${file}:${lineNumber} [${rule}] ${detail}`);
}

function stripLiteralsAndComments(line) {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '');
}

function splitIntoWords(identifier) {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_ ]+/)
    .map((word) => word.toLowerCase());
}

function checkIdentifier(file, lineNumber, identifier) {
  if (splitIntoWords(identifier).some((word) => SPANISH_WORDS.has(word))) {
    report(file, lineNumber, 'spanish-word', identifier);
  }
  if (VAGUE_NAMES.has(identifier.toLowerCase())) report(file, lineNumber, 'vague-name', identifier);
  if (HUNGARIAN_NOTATION.test(identifier)) report(file, lineNumber, 'hungarian-notation', identifier);
  if (NUMBERED_NAME.test(identifier)) report(file, lineNumber, 'numbered-name', identifier);
}

function checkFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((rawLine, index) => {
    if (rawLine.includes('naming-ignore')) return;
    const lineNumber = index + 1;
    const code = stripLiteralsAndComments(rawLine);
    if (NON_ASCII.test(code)) report(file, lineNumber, 'non-ascii-identifier', rawLine.trim());
    for (const identifier of code.match(IDENTIFIER) ?? []) {
      checkIdentifier(file, lineNumber, identifier);
    }
  });
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(entryPath);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      checkFile(entryPath);
    }
  }
}

walk(rootDirectory);
if (findingsCount === 0) console.log('No naming findings.');
process.exitCode = findingsCount > 0 ? 1 : 0;
