import { describe, expect, it } from 'vitest';
import {
  BackupError,
  backupFileName,
  countDocuments,
  decodeValue,
  decryptBackup,
  encryptBackup,
  parseBackup,
  parseBackupFileName,
  serializeBackup,
  verifyBackup,
} from './backup.js';
import { fingerprint } from './rules.js';

// Coste bajo para que las pruebas sean rápidas; el script usa KDF_DEFAULTS.
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSPHRASE = 'frase de prueba larga';
const META = { projectId: 'demo-lucas', ambiente: 'dev', now: Date.UTC(2026, 9, 27, 15) };

// Marca de tiempo con la forma de Timestamp del Admin SDK.
const timestamp = (seconds, nanoseconds = 0) => ({ seconds, nanoseconds, toMillis: () => seconds * 1000 });

const HISTORY = [
  { type: 'created', at: 1761000000000, status: 'pending' },
  { type: 'moved', at: 1761000500000, from: 'pending', to: 'in-progress' },
];

const collections = () => ({
  tasks: [
    {
      id: 't2',
      data: { text: 'Texto privado de una tarea', status: 'in-progress', order: 2, ownerId: 'u1', history: HISTORY },
    },
    { id: 't1', data: { text: 'Otra tarea', status: 'pending', order: 1, ownerId: 'u1', priority: null } },
  ],
  allowedUsers: [{ id: 'persona@ejemplo.test', data: { name: 'Persona', active: false, uid: 'u1' } }],
  adminLog: [
    { id: 'l1', data: { action: 'deactivate', actorUid: 'a1', targetUid: 'u1', at: timestamp(1761000000, 5) } },
  ],
});

describe('contenido del respaldo', () => {
  it('cuenta los documentos y no depende del orden en que llegan', () => {
    const first = serializeBackup(collections(), META);
    const reversed = Object.fromEntries(
      Object.entries(collections())
        .reverse()
        .map(([name, docs]) => [name, docs.reverse()]),
    );
    expect(first.documentCount).toBe(4);
    expect(serializeBackup(reversed, META).plaintext).toBe(first.plaintext);
  });

  it('conserva los historiales completos de las tareas (A-47) y las marcas de tiempo', () => {
    const content = parseBackup(serializeBackup(collections(), META).plaintext);
    const task = content.colecciones.tasks.find((doc) => doc.id === 't2');
    expect(task.datos.history).toEqual(HISTORY);
    expect(content).toMatchObject({ proyecto: 'demo-lucas', ambiente: 'dev', creado: META.now });

    const make = (seconds, nanoseconds) => ({ restored: true, seconds, nanoseconds });
    const entry = decodeValue(content.colecciones.adminLog[0].datos, make);
    expect(entry.at).toEqual({ restored: true, seconds: 1761000000, nanoseconds: 5 });
    expect(decodeValue(task.datos, make)).toEqual(collections().tasks[0].data);
  });

  it.each([
    ['un tipo que LUCAS no usa', { ref: new Map() }, 'Tipo de dato no soportado en tasks/t1.ref'],
    ['un número que JSON no representa', { order: Number.NaN }, 'Número no representable en tasks/t1.order'],
    ['un campo con el nombre reservado', { meta: { __tipo: 'x' } }, 'Campo reservado __tipo en tasks/t1.meta'],
  ])('detiene el respaldo ante %s, sin mostrar el valor', (_, data, message) => {
    const run = () => serializeBackup({ tasks: [{ id: 't1', data: { text: 'secreto', ...data } }] }, META);
    expect(run).toThrow(BackupError);
    expect(run).toThrow(message);
    expect(run).not.toThrow('secreto');
  });

  it('rechaza un texto que no es un respaldo de LUCAS', () => {
    expect(() => parseBackup('{"formato":"otro"}')).toThrow(BackupError);
  });
});

describe('cifrado AES-256-GCM', () => {
  const { plaintext, documentCount } = serializeBackup(collections(), META);

  it('descifra lo cifrado con la misma frase', () => {
    expect(decryptBackup(encryptBackup(plaintext, PASSPHRASE, FAST), PASSPHRASE)).toBe(plaintext);
  });

  it('el archivo no contiene nada en claro y usa sal e IV distintos cada vez', () => {
    const first = encryptBackup(plaintext, PASSPHRASE, FAST);
    const second = encryptBackup(plaintext, PASSPHRASE, FAST);
    expect(first).not.toContain('Texto privado');
    expect(first).not.toContain('persona@ejemplo.test');
    expect(first).not.toContain(PASSPHRASE);
    const a = JSON.parse(first);
    const b = JSON.parse(second);
    expect(a).toMatchObject({ cifrado: 'aes-256-gcm', kdf: { nombre: 'scrypt', N: FAST.N } });
    expect(a.kdf.sal).not.toBe(b.kdf.sal);
    expect(a.iv).not.toBe(b.iv);
    expect(a.datos).not.toBe(b.datos);
  });

  it('una frase distinta no descifra', () => {
    const file = encryptBackup(plaintext, PASSPHRASE, FAST);
    expect(() => decryptBackup(file, 'otra frase distinta')).toThrow('la frase no es correcta');
  });

  it.each([
    ['los datos', (envelope) => ({ ...envelope, datos: Buffer.from('cambiado').toString('base64') })],
    ['la etiqueta', (envelope) => ({ ...envelope, etiqueta: Buffer.alloc(16).toString('base64') })],
    ['el IV de la cabecera', (envelope) => ({ ...envelope, iv: Buffer.alloc(12).toString('base64') })],
    ['un parámetro de la cabecera', (envelope) => ({ ...envelope, kdf: { ...envelope.kdf, r: 4 } })],
  ])('detecta un cambio en %s', (_, tamper) => {
    const envelope = JSON.parse(encryptBackup(plaintext, PASSPHRASE, FAST));
    expect(() => decryptBackup(JSON.stringify(tamper(envelope)), PASSPHRASE)).toThrow(BackupError);
  });

  it('no acepta una derivación desmesurada ni un archivo que no es un respaldo', () => {
    const envelope = JSON.parse(encryptBackup(plaintext, PASSPHRASE, FAST));
    const huge = JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, N: 2 ** 24 } });
    expect(() => decryptBackup(huge, PASSPHRASE)).toThrow('parámetros de cifrado');
    expect(() => decryptBackup('no es json', PASSPHRASE)).toThrow('no es un respaldo cifrado');
  });

  describe('verificación antes del marcador', () => {
    const hash = fingerprint(plaintext);
    const file = encryptBackup(plaintext, PASSPHRASE, FAST);

    it('pasa con la misma huella y el mismo número de documentos', () => {
      expect(countDocuments(verifyBackup(file, PASSPHRASE, { hash, documentCount }))).toBe(documentCount);
    });

    it('falla si la huella o el número de documentos no coinciden con lo leído', () => {
      expect(() => verifyBackup(file, PASSPHRASE, { hash: fingerprint('otro'), documentCount })).toThrow('huella');
      expect(() => verifyBackup(file, PASSPHRASE, { hash, documentCount: documentCount + 1 })).toThrow('número');
    });
  });
});

describe('nombre del archivo de respaldo', () => {
  it('lleva el ambiente y la hora UTC, nunca un correo', () => {
    const name = backupFileName('pdn', Date.UTC(2026, 9, 27, 15, 4, 5));
    expect(name).toBe('respaldo-pdn-2026-10-27T15-04-05Z.cifrado');
    expect(parseBackupFileName(name)).toEqual({ ambiente: 'pdn', createdAt: Date.UTC(2026, 9, 27, 15, 4, 5) });
  });

  it.each(['respaldo-qa-2026-10-27T15-04-05Z.cifrado', 'respaldo-dev-2026-10-27.json', 'notas.txt', '.DS_Store'])(
    '%s no es un respaldo',
    (name) => {
      expect(parseBackupFileName(name)).toBeNull();
    },
  );
});
