// Regla de dependencias de la arquitectura limpia (docs/PLAN_ARQUITECTURA.md): cada capa solo
// importa de las capas permitidas. Si esta prueba falla, el import nuevo va en otra capa.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;

const ALLOWED = {
  domain: ['domain'],
  data: ['domain', 'data', 'shared'],
  shared: ['shared'],
  presentation: ['domain', 'data', 'shared', 'presentation'],
};

// Paquetes de npm que cada capa puede usar. El SDK de Firebase solo entra por la capa de datos.
const ALLOWED_PACKAGES = {
  domain: [],
  data: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
  shared: [],
  presentation: [],
};

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [path] : [];
  });
}

// import … from '…', export … from '…' e import('…').
function importsOf(file) {
  const code = readFileSync(file, 'utf-8');
  return [...code.matchAll(/(?:from\s+|import\()\s*'([^']+)'/g)].map((match) => match[1]);
}

const layerOf = (file) => relative(SRC, file).split('/')[0];

describe('dependencias entre capas', () => {
  const files = Object.keys(ALLOWED).flatMap((layer) => sourceFiles(join(SRC, layer)));

  it('encuentra el código de todas las capas', () => {
    expect(new Set(files.map(layerOf))).toEqual(new Set(Object.keys(ALLOWED)));
  });

  it.each(files.map((file) => [relative(SRC, file), file]))('%s solo importa de capas permitidas', (_, file) => {
    const layer = layerOf(file);
    const violations = importsOf(file).filter((specifier) => {
      if (!specifier.startsWith('.')) return !ALLOWED_PACKAGES[layer].includes(specifier);
      const target = layerOf(normalize(join(dirname(file), specifier)));
      return !ALLOWED[layer].includes(target);
    });
    expect(violations).toEqual([]);
  });

  it('el dominio no usa el navegador', () => {
    const browserGlobals = /\b(document|window|localStorage|sessionStorage)\./;
    const offenders = sourceFiles(join(SRC, 'domain')).filter((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .some((line) => !/^\s*(\/\/|\*)/.test(line) && browserGlobals.test(line)),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });
});
