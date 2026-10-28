// Comandos del script contra un almacén y una terminal simulados en memoria: sin Firebase, sin red y sin
// datos reales. Los respaldos se escriben en una carpeta temporal.
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupError, decryptBackup, parseBackup } from './backup.js';
import { completeIndex } from './completar-indice.js';
import { Refusal } from './context.js';
import { backupUser } from './respaldar.js';
import { fingerprint } from './rules.js';
import { verifyIndex } from './verificar-indice.js';

const NOW = Date.UTC(2026, 9, 27, 15);
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSPHRASE = 'frase de prueba larga';
const ADMIN = 'admin@ejemplo.test';
const PERSONA = 'persona@ejemplo.test';
const PRIVATE_TEXT = 'Texto privado de la tarea';
const HISTORY = [
  { type: 'created', at: 1, status: 'pending' },
  { type: 'moved', at: 2, from: 'pending', to: 'completed' },
];

const seed = () => ({
  allowedUsers: {
    [ADMIN]: { name: 'Admin', role: 'admin', active: true, uid: 'admin-uid' },
    [PERSONA]: { name: 'Persona', role: 'member', active: false, uid: 'u1', lastChange: 'l0' },
    'activa@ejemplo.test': { name: 'Activa', active: true, uid: 'u2' },
  },
  tasks: {
    t1: { text: `${PRIVATE_TEXT} 1`, status: 'completed', order: 1, ownerId: 'u1', history: HISTORY },
    t2: { text: `${PRIVATE_TEXT} 2`, status: 'pending', order: 2, ownerId: 'u1' },
    t3: { text: 'De otra persona', status: 'pending', order: 1, ownerId: 'u2' },
  },
  // t2 no tiene índice y "huerfano" es de una tarea que ya no existe.
  taskIndex: { t1: { ownerId: 'u1' }, t3: { ownerId: 'u2' }, huerfano: { ownerId: 'u1' } },
  adminLog: {
    viejo: { action: 'deactivate', actorUid: 'admin-uid', targetUid: 'u1', at: Date.UTC(2025, 5, 1) },
    reciente: { action: 'deactivate', actorUid: 'admin-uid', targetUid: 'u1', at: Date.UTC(2026, 8, 1) },
  },
});

const account = (uid, email) => ({ uid, email, disabled: false, createdAt: null, lastSignInAt: null });
const denied = () =>
  Object.assign(new Error('Caller does not have permission'), { code: 'auth/insufficient-permission' });

// Almacén en memoria con la misma interfaz que store.js.
function createFakeStore(data, { accounts = [], authError = null } = {}) {
  const db = new Map(
    Object.entries(data).map(([name, docs]) => [name, new Map(Object.entries(structuredClone(docs)))]),
  );
  const collection = (name) => db.get(name) ?? db.set(name, new Map()).get(name);
  const auth = () => {
    if (authError) throw authError;
  };
  let lastId = 0;
  return {
    commits: [],
    accounts: [...accounts],
    doc: (name, id) => collection(name).get(id),
    docs: (name) => Object.fromEntries(collection(name)),
    async get(name, id) {
      return collection(name).has(id) ? structuredClone(collection(name).get(id)) : null;
    },
    async listUsers() {
      return [...collection('allowedUsers')].map(([email, doc]) => ({ email, data: structuredClone(doc) }));
    },
    async listOwners(name, uid) {
      return [...collection(name)]
        .filter(([, doc]) => !uid || doc.ownerId === uid)
        .map(([id, doc]) => ({ id, ownerId: doc.ownerId }));
    },
    async ownersOf(name, ids) {
      return ids
        .filter((id) => collection(name).has(id))
        .map((id) => ({ id, ownerId: collection(name).get(id).ownerId }));
    },
    async countAll() {
      return Object.fromEntries([...db].filter(([, docs]) => docs.size).map(([name, docs]) => [name, docs.size]));
    },
    async readAll() {
      return Object.fromEntries(
        [...db]
          .filter(([, docs]) => docs.size)
          .map(([name, docs]) => [name, [...docs].map(([id, doc]) => ({ id, data: structuredClone(doc) }))]),
      );
    },
    async logIdsBefore(before) {
      return [...collection('adminLog')].filter(([, entry]) => entry.at < before.getTime()).map(([id]) => id);
    },
    async commit(ops) {
      this.commits.push(ops);
      for (const op of ops) {
        if (op.type === 'log') collection('adminLog').set(op.id, { ...op.entry, at: 'hora del servidor' });
        else if (op.type === 'delete') collection(op.collection).delete(op.id);
        else if (op.type === 'update') Object.assign(collection(op.collection).get(op.id), op.data);
        else collection(op.collection).set(op.id, structuredClone(op.data));
      }
    },
    newId: () => `log-${++lastId}`,
    timestamp: (seconds, nanoseconds) => ({ seconds, nanoseconds }),
    async findAccountByEmail(email) {
      auth();
      return this.accounts.find((a) => a.email === email) ?? null;
    },
    async findAccountByUid(uid) {
      auth();
      return this.accounts.find((a) => a.uid === uid) ?? null;
    },
    async listAccounts() {
      auth();
      return [...this.accounts];
    },
    async deleteAccount(uid) {
      auth();
      this.accounts = this.accounts.filter((a) => a.uid !== uid);
    },
  };
}

// Responde las preguntas en orden; una pregunta de más hace fallar la prueba.
function fakeTerminal(answers) {
  const questions = [];
  const next = async (question) => {
    questions.push(question);
    if (answers.length === 0) throw new Error(`Pregunta inesperada: ${question}`);
    return answers.shift();
  };
  return { questions, ask: next, askHidden: next };
}

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lucas-admin-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const backupFiles = (ambiente = 'dev') => readdir(join(dir, ambiente)).catch(() => []);

function setup({ data = seed(), accounts = [], authError = null, answers = [], ...options } = {}) {
  const store = createFakeStore(data, { accounts, authError });
  const lines = [];
  const context = {
    options: { command: 'prueba', ambiente: 'dev', aplicar: false, admin: ADMIN, ...options },
    projectId: 'demo-lucas',
    store,
    terminal: fakeTerminal([...answers]),
    log: (line) => lines.push(line),
    now: () => NOW,
    backupDir: dir,
    kdf: FAST,
  };
  return { context, store, output: () => lines.join('\n') };
}

const lastEntry = (store) => store.commits.at(-1).at(-1).entry;

describe('quién ejecuta el script', () => {
  it.each([
    ['no está autorizado', 'nadie@ejemplo.test', 'no está en allowedUsers'],
    ['es miembro', 'activa@ejemplo.test', 'no es un administrador activo'],
  ])('se niega si --admin %s', async (_, admin, message) => {
    const { context, store } = setup({ admin, correo: PERSONA });
    await expect(backupUser(context)).rejects.toThrow(message);
    expect(store.commits).toEqual([]);
  });

  it('se niega si el administrador no tiene uid (no podría firmar sus entradas)', async () => {
    const data = seed();
    delete data.allowedUsers[ADMIN].uid;
    await expect(backupUser(setup({ data, correo: PERSONA }).context)).rejects.toThrow('no tiene uid');
  });
});

describe('respaldar', () => {
  const apply = (extra = {}) => setup({ correo: PERSONA, aplicar: true, answers: [PASSPHRASE, PASSPHRASE], ...extra });

  it('en simulación informa sin escribir nada ni mostrar tareas o correos completos', async () => {
    const { context, store, output } = setup({ correo: PERSONA });
    expect(await backupUser(context)).toBe(0);
    expect(store.commits).toEqual([]);
    expect(await backupFiles()).toEqual([]);
    expect(output()).toContain('Persona: pe***@e***.test');
    expect(output()).toContain('Tareas: 2 · índices que faltan: 1 · índices huérfanos: 1');
    expect(output()).toContain('El respaldo completo tendría 11 documentos');
    expect(output()).toContain('Simulación: no se escribió nada');
    expect(output()).not.toContain(PRIVATE_TEXT);
    expect(output()).not.toContain(PERSONA);
  });

  it.each([
    ['está activa', 'activa@ejemplo.test', {}, 'desactívala primero'],
    ['es administradora', 'otra@ejemplo.test', { role: 'admin', active: false }, 'quítale primero el rol'],
    [
      'ya está en eliminación',
      'otra@ejemplo.test',
      { active: false, deleting: { at: 1, doneLogId: 'x' } },
      'ya está en eliminación',
    ],
    ['es quien ejecuta', ADMIN, {}, 'a ti mismo'],
    ['no está autorizada', 'nadie@ejemplo.test', null, 'no está en allowedUsers'],
  ])('se niega si la persona %s', async (_, correo, doc, message) => {
    const data = seed();
    if (doc && !data.allowedUsers[correo]) data.allowedUsers[correo] = { name: 'Otra', uid: 'u9', ...doc };
    const { context, store } = apply({ data, correo });
    await expect(backupUser(context)).rejects.toThrow(Refusal);
    await expect(backupUser(context)).rejects.toThrow(message);
    expect(store.commits).toEqual([]);
  });

  it('con --aplicar completa el índice, cifra, verifica y crea el marcador junto con su entrada', async () => {
    const { context, store, output } = apply();
    expect(await backupUser(context)).toBe(0);
    expect(store.docs('taskIndex')).toEqual({ t1: { ownerId: 'u1' }, t2: { ownerId: 'u1' }, t3: { ownerId: 'u2' } });

    const [name] = await backupFiles();
    const path = join(dir, 'dev', name);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'dev'))).mode & 0o777).toBe(0o700);
    const file = await readFile(path, 'utf8');
    expect(file).not.toContain(PRIVATE_TEXT);
    const plaintext = decryptBackup(file, PASSPHRASE);
    const t1 = parseBackup(plaintext).colecciones.tasks.find((doc) => doc.id === 't1');
    expect(t1.datos.history).toEqual(HISTORY); // A-47

    expect(store.doc('deletions', 'u1')).toEqual({
      state: 'backup-ready',
      taskCount: 2,
      backupAt: NOW,
      backupHash: fingerprint(plaintext),
    });
    const markerBatch = store.commits.at(-1);
    expect(markerBatch.map((op) => op.collection ?? op.type)).toEqual(['deletions', 'log']);
    expect(lastEntry(store)).toEqual({
      action: 'backup',
      actorUid: 'admin-uid',
      targetUid: 'u1',
      detail: { taskCount: 2, documentCount: 11, indexCreated: 1, indexRemoved: 1, uidRegistered: false },
    });
    expect(JSON.stringify(store.docs('adminLog'))).not.toContain('@');
    expect(output()).not.toContain(PRIVATE_TEXT);
  });

  it('sin uid en su documento lo toma de Authentication y lo registra antes del respaldo (A-30)', async () => {
    const data = seed();
    delete data.allowedUsers[PERSONA].uid;
    const { context, store } = apply({ data, accounts: [account('u1', PERSONA)] });
    await backupUser(context);
    expect(store.doc('allowedUsers', PERSONA).uid).toBe('u1');
    expect(store.doc('deletions', 'u1')).toMatchObject({ state: 'backup-ready', taskCount: 2 });
    expect(lastEntry(store).detail.uidRegistered).toBe(true);
  });

  it('sin uid ni cuenta en Authentication: el marcador usa el correo y no hay tareas', async () => {
    const data = seed();
    delete data.allowedUsers[PERSONA].uid;
    const { context, store, output } = apply({ data });
    await backupUser(context);
    expect(output()).toContain('nunca entró');
    expect(store.doc('deletions', PERSONA)).toMatchObject({ state: 'backup-ready', taskCount: 0 });
    expect(store.doc('taskIndex', 'huerfano')).toBeDefined();
  });

  it('si Authentication no responde con tus credenciales (A-19), se niega sin escribir nada', async () => {
    const data = seed();
    delete data.allowedUsers[PERSONA].uid;
    const { context, store } = apply({ data, authError: denied() });
    await expect(backupUser(context)).rejects.toThrow('A-19');
    expect(store.commits).toEqual([]);
  });

  it('en PDN exige escribir el identificador del proyecto antes de escribir', async () => {
    const wrong = apply({ ambiente: 'pdn', answers: ['tablero-equivocado'] });
    await expect(backupUser(wrong.context)).rejects.toThrow('no coincide');
    expect(wrong.store.commits).toEqual([]);

    const right = apply({ ambiente: 'pdn', answers: ['demo-lucas', PASSPHRASE, PASSPHRASE] });
    expect(await backupUser(right.context)).toBe(0);
    expect(await backupFiles('pdn')).toHaveLength(1);
  });

  it.each([
    [['corta', 'corta'], 'al menos 12'],
    [[PASSPHRASE, 'otra frase distinta'], 'no coinciden'],
  ])('se niega con una frase inválida y no escribe nada', async (answers, message) => {
    const { context, store } = apply({ answers });
    await expect(backupUser(context)).rejects.toThrow(message);
    expect(store.commits).toEqual([]);
  });

  it('se niega si la eliminación ya está confirmada', async () => {
    const data = { ...seed(), deletions: { u1: { state: 'deleting' } } };
    await expect(backupUser(apply({ data }).context)).rejects.toThrow('ya está confirmada');
  });

  it('si el respaldo falla tras completar el índice, deja su entrada y no crea el marcador', async () => {
    const data = seed();
    data.tasks.rara = { text: 'x', status: 'pending', order: 3, ownerId: 'u2', extra: new Map() };
    const { context, store } = apply({ data });
    await expect(backupUser(context)).rejects.toThrow(BackupError);
    expect(store.doc('deletions', 'u1')).toBeUndefined();
    expect(await backupFiles()).toEqual([]);
    expect(lastEntry(store)).toMatchObject({
      action: 'backup',
      detail: { completed: false, indexCreated: 1, indexRemoved: 1, uidRegistered: false },
    });
  });
});

describe('verificar-indice y completar-indice', () => {
  it('verificar-indice da cantidades e identificadores y termina con 1 si el índice no está completo', async () => {
    const { context, store, output } = setup();
    expect(await verifyIndex(context)).toBe(1);
    expect(output()).toContain('Tareas: 3 · documentos de taskIndex: 3');
    expect(output()).toContain('Tareas sin índice: 1\n  t2');
    expect(output()).toContain('Índices huérfanos (sin tarea): 1\n  huerfano');
    expect(output()).not.toContain(PRIVATE_TEXT);
    expect(store.commits).toEqual([]);
  });

  it('con --uid mira solo a esa persona', async () => {
    expect(await verifyIndex(setup({ uid: 'u2' }).context)).toBe(0);
  });

  it('completar-indice simula y, con --aplicar, deja el índice completo con su entrada', async () => {
    const simulation = setup();
    expect(await completeIndex(simulation.context)).toBe(0);
    expect(simulation.store.commits).toEqual([]);

    const { context, store } = setup({ aplicar: true });
    expect(await completeIndex(context)).toBe(0);
    expect(store.commits).toHaveLength(1);
    expect(lastEntry(store)).toEqual({
      action: 'backfill-index',
      actorUid: 'admin-uid',
      targetUid: null,
      detail: { created: 1, fixed: 0, removed: 1 },
    });
    const check = setup({ data: { ...seed(), taskIndex: store.docs('taskIndex') } });
    expect(await verifyIndex(check.context)).toBe(0);
  });
});
