import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { createAdminUsersRepository } from './AdminUsersRepository.js';
import { createAllowedUsersRepository } from './AllowedUsersRepository.js';
import { createFirebaseAuthRepository } from './FirebaseAuthRepository.js';
import { TASK_CHUNK_SIZE, createFirestoreTaskRepository, toDocument } from './FirestoreTaskRepository.js';
import { SAVED_WITHOUT_HISTORY, createLocalTaskCache } from './LocalTaskCache.js';
import { createReminderStore } from './ReminderStore.js';

const firebaseError = (code) => Object.assign(new Error(code), { code });

const task = (id, fields = {}) => ({
  id,
  text: id,
  status: 'pending',
  order: 0,
  createdAt: 1,
  startedAt: null,
  completedAt: null,
  priority: null,
  dueDate: null,
  ...fields,
});

// SDK de Firestore falso: registra las llamadas y permite simular errores.
function fakeFirestore() {
  const calls = [];
  const fs = {
    failWith: null,
    doc: (db, collection, id) => `${collection}/${id}`,
    collection: (db, name) => name,
    where: (field, op, value) => ({ field, op, value }),
    query: (collection, filter) => ({ collection, filter }),
    getDocsFromServer: async (query) => {
      calls.push(['getFromServer', query]);
      if (fs.failWith) throw fs.failWith;
      return { docs: (fs.serverDocs ?? []).map((id) => ({ id })) };
    },
    arrayUnion: (...elements) => ({ arrayUnion: elements }),
    setDoc: async (ref, data) => {
      calls.push(['set', ref, data]);
      if (fs.failWith) throw fs.failWith;
    },
    updateDoc: async (ref, data) => {
      calls.push(['update', ref, data]);
      if (fs.failWith) throw fs.failWith;
    },
    writeBatch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(['set', ref, data]),
        delete: (ref) => ops.push(['delete', ref]),
        commit: async () => {
          calls.push(['batch', ops]);
          if (fs.failWith) throw fs.failWith;
        },
      };
    },
    onSnapshot: (query, options, next, error) => {
      fs.listener = { query, options, next, error };
      return () => calls.push(['unsubscribe']);
    },
  };
  return { db: 'db', fs, calls };
}

describe('FirestoreTaskRepository', () => {
  it('guarda la tarea con su dueño, sin el id ni las etiquetas vacías, y su índice en el mismo lote', async () => {
    const { db, fs, calls } = fakeFirestore();
    await createFirestoreTaskRepository({ db, fs }, 'uid-1').save(task('t1'));
    expect(calls).toEqual([
      [
        'batch',
        [
          [
            'set',
            'tasks/t1',
            {
              text: 't1',
              status: 'pending',
              order: 0,
              createdAt: 1,
              startedAt: null,
              completedAt: null,
              ownerId: 'uid-1',
            },
          ],
          ['set', 'taskIndex/t1', { ownerId: 'uid-1' }],
        ],
      ],
    ]);
  });

  it('toDocument conserva las etiquetas que tienen valor', () => {
    expect(toDocument(task('t', { priority: 'urgent', dueDate: '2026-10-15' }), 'u')).toMatchObject({
      priority: 'urgent',
      dueDate: '2026-10-15',
      ownerId: 'u',
    });
  });

  const event = (id) => ({ id, type: 'move', at: 2, from: 'pending', to: 'in-progress' });

  it('toDocument conserva el historial y no lo envía si la tarea aún no tiene', () => {
    expect(toDocument(task('t', { history: [event('e1')] }), 'u').history).toEqual([event('e1')]);
    expect(toDocument(task('t', { history: [] }), 'u').history).toEqual([]);
    expect(toDocument(task('t', { history: null }), 'u')).not.toHaveProperty('history');
  });

  it('save y saveAll guardan la tarea con su historial', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    await repository.save(task('a', { history: [event('e1')] }));
    await repository.saveAll([task('b', { history: [event('e2')] })]);
    expect(calls[0][1][0][2].history).toEqual([event('e1')]);
    expect(calls[1][1][0][2].history).toEqual([event('e2')]);
  });

  it('update traduce el plan del historial en la misma escritura que los campos', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    await repository.update('t1', { status: 'in-progress' }, { mode: 'append', events: [event('e1'), event('e2')] });
    await repository.update('t1', { text: 'x' }, { mode: 'replace', history: [event('e3')] });
    await repository.update('t1', { createdAt: 5 });
    expect(calls).toEqual([
      ['update', 'tasks/t1', { status: 'in-progress', history: { arrayUnion: [event('e1'), event('e2')] } }],
      ['update', 'tasks/t1', { text: 'x', history: [event('e3')] }],
      ['update', 'tasks/t1', { createdAt: 5 }],
    ]);
  });

  it('subscribe lee el historial de cada documento', () => {
    const { db, fs } = fakeFirestore();
    const onChange = vi.fn();
    createFirestoreTaskRepository({ db, fs }, 'u').subscribe(onChange, vi.fn());
    const doc = { id: 'a', data: () => ({ text: 'a', history: [event('e1'), 'basura'] }), metadata: {} };
    fs.listener.next({ docs: [doc], docChanges: () => [], metadata: { fromCache: false } });
    expect(onChange.mock.calls[0][0].tasks[0].history).toEqual([event('e1')]);
  });

  it('update ignora las tareas que otro dispositivo ya borró', async () => {
    const { db, fs } = fakeFirestore();
    fs.failWith = firebaseError('not-found');
    await expect(createFirestoreTaskRepository({ db, fs }, 'u').update('t1', { text: 'x' })).resolves.toBeUndefined();
  });

  it('traduce los errores de Firestore a RepositoryError', async () => {
    const { db, fs } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');

    fs.failWith = firebaseError('permission-denied');
    await expect(repository.save(task('t1'))).rejects.toMatchObject({ reason: 'permission-denied' });

    fs.failWith = firebaseError('unavailable');
    const error = await repository.update('t1', {}).catch((e) => e);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error.reason).toBe('unavailable');
    expect(error.cause.code).toBe('unavailable');
  });

  it('remove borra cada tarea con su índice, y saveAll las sube con el suyo, en el mismo lote', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    await repository.remove([]);
    await repository.remove(['a', 'b']);
    await repository.saveAll([task('c')]);
    expect(calls).toEqual([
      [
        'batch',
        [
          ['delete', 'tasks/a'],
          ['delete', 'taskIndex/a'],
          ['delete', 'tasks/b'],
          ['delete', 'taskIndex/b'],
        ],
      ],
      [
        'batch',
        [
          ['set', 'tasks/c', expect.objectContaining({ ownerId: 'u' })],
          ['set', 'taskIndex/c', { ownerId: 'u' }],
        ],
      ],
    ]);
  });

  it('parte remove y saveAll en trozos de 8 tareas (16 documentos por lote)', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    const ids = Array.from({ length: 17 }, (_, i) => `t${i}`);
    await repository.remove(ids);
    await repository.saveAll(ids.map((id) => task(id)));
    expect(TASK_CHUNK_SIZE).toBe(8);
    expect(calls.map(([, ops]) => ops.length)).toEqual([16, 16, 2, 16, 16, 2]);
    expect(calls[1][1][0]).toEqual(['delete', 'tasks/t8']);
    expect(calls[5][1]).toEqual([
      ['set', 'tasks/t16', expect.objectContaining({ ownerId: 'u' })],
      ['set', 'taskIndex/t16', { ownerId: 'u' }],
    ]);
  });

  it('si falla un trozo se detiene, y los anteriores quedan escritos', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    let commits = 0;
    const writeBatch = fs.writeBatch;
    fs.writeBatch = () => {
      const batch = writeBatch();
      const commit = batch.commit;
      batch.commit = async () => {
        await commit();
        if (++commits === 2) throw firebaseError('unavailable');
      };
      return batch;
    };
    const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
    await expect(repository.remove(ids)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(calls).toHaveLength(2);
  });

  it('editar o mover no toca el índice', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    await repository.update('t1', { text: 'x' });
    await repository.update('t1', { status: 'completed', completedAt: 3 }, { mode: 'append', events: [event('e1')] });
    expect(calls.every(([kind, ref]) => kind === 'update' && ref === 'tasks/t1')).toBe(true);
  });

  it('lee del servidor los IDs de su índice y lo completa o limpia en trozos', async () => {
    const { db, fs, calls } = fakeFirestore();
    const repository = createFirestoreTaskRepository({ db, fs }, 'u');
    fs.serverDocs = ['a', 'b'];
    await expect(repository.indexedIds()).resolves.toEqual(['a', 'b']);
    expect(calls[0]).toEqual([
      'getFromServer',
      { collection: 'taskIndex', filter: { field: 'ownerId', op: '==', value: 'u' } },
    ]);

    const ids = Array.from({ length: 9 }, (_, i) => `t${i}`);
    await repository.addToIndex(ids);
    await repository.removeFromIndex(['z']);
    await repository.addToIndex([]);
    expect(calls.slice(1)).toEqual([
      ['batch', ids.slice(0, 8).map((id) => ['set', `taskIndex/${id}`, { ownerId: 'u' }])],
      ['batch', [['set', 'taskIndex/t8', { ownerId: 'u' }]]],
      ['batch', [['delete', 'taskIndex/z']]],
    ]);

    fs.failWith = firebaseError('permission-denied');
    await expect(repository.indexedIds()).rejects.toMatchObject({ reason: 'permission-denied' });
  });

  it('subscribe filtra por dueño y separa las tareas creadas en otro dispositivo', () => {
    const { db, fs, calls } = fakeFirestore();
    const onChange = vi.fn();
    const onError = vi.fn();
    const stop = createFirestoreTaskRepository({ db, fs }, 'uid-1').subscribe(onChange, onError);

    expect(fs.listener.query.filter).toEqual({ field: 'ownerId', op: '==', value: 'uid-1' });
    expect(fs.listener.options).toEqual({ includeMetadataChanges: true });

    const doc = (id, pending) => ({
      id,
      data: () => ({ text: id, status: 'pending' }),
      metadata: { hasPendingWrites: pending },
    });
    const mine = doc('mia', true);
    const theirs = doc('ajena', false);
    fs.listener.next({
      docs: [mine, theirs],
      docChanges: () => [
        { type: 'added', doc: mine },
        { type: 'added', doc: theirs },
        { type: 'modified', doc: theirs },
      ],
      metadata: { fromCache: false },
    });
    const snapshot = onChange.mock.calls[0][0];
    expect(snapshot.tasks.map((t) => t.id)).toEqual(['mia', 'ajena']);
    expect(snapshot.added.map((t) => t.id)).toEqual(['ajena']);
    expect(snapshot.fromCache).toBe(false);

    fs.listener.error(firebaseError('permission-denied'));
    expect(onError.mock.calls[0][0]).toMatchObject({ reason: 'permission-denied' });

    stop();
    expect(calls).toContainEqual(['unsubscribe']);
  });
});

describe('AdminUsersRepository', () => {
  const entry = { id: 'log-1', action: 'deactivate', actorUid: 'u-admin', targetUid: 'u-ana' };

  // SDK falso con lo que usa la gestión de usuarios: lotes, transacciones, escucha y hora del servidor.
  function fakeAdminFirestore({ existing = [] } = {}) {
    const calls = [];
    const fs = {
      failWith: null,
      doc: (db, collection, id) => `${collection}/${id}`,
      collection: (db, name) => name,
      serverTimestamp: () => 'SERVER_TIME',
      writeBatch: () => {
        const ops = [];
        return {
          set: (ref, data) => ops.push(['set', ref, data]),
          update: (ref, data) => ops.push(['update', ref, data]),
          commit: async () => {
            calls.push(['batch', ops]);
            if (fs.failWith) throw fs.failWith;
          },
        };
      },
      runTransaction: async (db, run) => {
        const ops = [];
        const transaction = {
          get: async (ref) => ({ exists: () => existing.includes(ref) }),
          set: (ref, data) => ops.push(['set', ref, data]),
        };
        await run(transaction);
        if (fs.failWith) throw fs.failWith;
        calls.push(['transaction', ops]);
      },
      onSnapshot: (ref, next, error) => {
        fs.listener = { ref, next, error };
        return () => calls.push(['unsubscribe']);
      },
    };
    return { db: 'db', fs, calls };
  }

  it('update escribe el cambio, lastChange y la entrada con la hora del servidor en el mismo lote', async () => {
    const { db, fs, calls } = fakeAdminFirestore();
    await createAdminUsersRepository({ db, fs }).update('ana@x.com', { active: false }, entry);
    expect(calls).toEqual([
      [
        'batch',
        [
          ['update', 'allowedUsers/ana@x.com', { active: false, lastChange: 'log-1' }],
          [
            'set',
            'adminLog/log-1',
            { action: 'deactivate', actorUid: 'u-admin', targetUid: 'u-ana', at: 'SERVER_TIME' },
          ],
        ],
      ],
    ]);
  });

  it('create escribe un documento mínimo y su entrada en la misma transacción', async () => {
    const { db, fs, calls } = fakeAdminFirestore();
    const authorize = { ...entry, action: 'authorize', targetUid: null, detail: { role: 'member' } };
    await createAdminUsersRepository({ db, fs }).create({ email: 'ana@x.com', name: 'Ana', role: 'member' }, authorize);
    expect(calls).toEqual([
      [
        'transaction',
        [
          ['set', 'allowedUsers/ana@x.com', { name: 'Ana', role: 'member', active: true, lastChange: 'log-1' }],
          [
            'set',
            'adminLog/log-1',
            {
              action: 'authorize',
              actorUid: 'u-admin',
              targetUid: null,
              detail: { role: 'member' },
              at: 'SERVER_TIME',
            },
          ],
        ],
      ],
    ]);
  });

  it('create falla con already-exists si el correo ya está autorizado, sin escribir nada', async () => {
    const { db, fs, calls } = fakeAdminFirestore({ existing: ['allowedUsers/ana@x.com'] });
    const create = createAdminUsersRepository({ db, fs }).create(
      { email: 'ana@x.com', name: 'Ana', role: 'admin' },
      entry,
    );
    await expect(create).rejects.toMatchObject({ name: 'RepositoryError', reason: 'already-exists' });
    expect(calls).toEqual([]);
  });

  it('traduce los errores de Firestore a RepositoryError', async () => {
    const { db, fs } = fakeAdminFirestore();
    fs.failWith = firebaseError('permission-denied');
    const repository = createAdminUsersRepository({ db, fs });
    await expect(repository.update('ana@x.com', { role: 'admin' }, entry)).rejects.toMatchObject({
      reason: 'permission-denied',
    });
    fs.failWith = firebaseError('unavailable');
    await expect(repository.create({ email: 'b@x.com', name: 'B', role: 'member' }, entry)).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('watch entrega las personas como AllowedUser y traduce los errores', () => {
    const { db, fs, calls } = fakeAdminFirestore();
    const onChange = vi.fn();
    const onError = vi.fn();
    const stop = createAdminUsersRepository({ db, fs }).watch(onChange, onError);
    expect(fs.listener.ref).toBe('allowedUsers');

    fs.listener.next({
      docs: [
        { id: 'ana@x.com', data: () => ({ name: 'Ana' }) },
        { id: 'admin@x.com', data: () => ({ name: 'Admin', role: 'admin', active: true, uid: 'u1' }) },
      ],
    });
    expect(onChange.mock.calls[0][0]).toMatchObject([
      { email: 'ana@x.com', role: 'member', active: true, uid: null, deleting: false },
      { email: 'admin@x.com', role: 'admin', uid: 'u1' },
    ]);

    fs.listener.error(firebaseError('permission-denied'));
    expect(onError.mock.calls[0][0]).toBeInstanceOf(RepositoryError);
    expect(onError.mock.calls[0][0].reason).toBe('permission-denied');

    stop();
    expect(calls).toEqual([['unsubscribe']]);
  });
});

describe('AllowedUsersRepository', () => {
  const repo = (getDoc) => createAllowedUsersRepository({ db: 'db', fs: { doc: (db, c, id) => `${c}/${id}`, getDoc } });

  it('devuelve la persona autorizada (un documento legado es miembro activo), o null si no lo está', async () => {
    const found = repo(async (ref) => ({ exists: () => true, data: () => ({ name: `  ${ref}  ` }) }));
    expect(await found.find('ana@x.com')).toEqual({
      email: 'ana@x.com',
      name: 'allowedUsers/ana@x.com',
      role: 'member',
      active: true,
      uid: null,
      permissions: {},
      deleting: false,
      doneLogId: null,
    });

    const missing = repo(async () => ({ exists: () => false }));
    expect(await missing.find('nadie@x.com')).toBeNull();

    const noName = repo(async () => ({ exists: () => true, data: () => ({}) }));
    expect(await noName.find('a@x.com')).toMatchObject({ name: '' });

    const admin = repo(async () => ({ exists: () => true, data: () => ({ name: 'Admin', role: 'admin', uid: 'u9' }) }));
    expect(await admin.find('admin@x.com')).toMatchObject({ role: 'admin', active: true, uid: 'u9' });
  });

  it('claimUid escribe solo el campo uid y traduce los errores', async () => {
    const writes = [];
    const fs = {
      doc: (db, c, id) => `${c}/${id}`,
      updateDoc: async (ref, data) => {
        writes.push([ref, data]);
        if (fs.failWith) throw fs.failWith;
      },
    };
    const repository = createAllowedUsersRepository({ db: 'db', fs });
    await repository.claimUid('ana@x.com', 'u1');
    expect(writes).toEqual([['allowedUsers/ana@x.com', { uid: 'u1' }]]);

    fs.failWith = firebaseError('permission-denied');
    await expect(repository.claimUid('ana@x.com', 'u1')).rejects.toMatchObject({ reason: 'permission-denied' });
    fs.failWith = firebaseError('unavailable');
    await expect(repository.claimUid('ana@x.com', 'u1')).rejects.toBeInstanceOf(RepositoryError);
  });

  it('distingue "sin permiso" de "sin conexión"', async () => {
    await expect(repo(() => Promise.reject(firebaseError('permission-denied'))).find('a')).rejects.toMatchObject({
      reason: 'permission-denied',
    });
    await expect(repo(() => Promise.reject(firebaseError('unavailable'))).find('a')).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });
});

describe('FirebaseAuthRepository', () => {
  it('reenvía el correo sin dirección de regreso si el dominio no está autorizado', async () => {
    const sent = [];
    const authSdk = {
      sendPasswordResetEmail: async (auth, email, settings) => {
        sent.push(settings);
        if (settings) throw firebaseError('auth/unauthorized-continue-uri');
      },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createFirebaseAuthRepository({ auth: {}, authSdk }).sendPasswordReset('a@x.com', 'https://x/login.html');
    expect(sent).toEqual([{ url: 'https://x/login.html' }, undefined]);
  });

  it('no reintenta con otros errores', async () => {
    const authSdk = { sendEmailVerification: () => Promise.reject(firebaseError('auth/too-many-requests')) };
    await expect(
      createFirebaseAuthRepository({ auth: {}, authSdk }).sendEmailVerification({}, 'https://x'),
    ).rejects.toMatchObject({ code: 'auth/too-many-requests' });
  });

  it('cambia la contraseña reautenticando primero con la actual', async () => {
    const steps = [];
    const authSdk = {
      EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
      reauthenticateWithCredential: async (user, credential) => steps.push(['reauth', credential]),
      updatePassword: async (user, next) => steps.push(['update', next]),
    };
    await createFirebaseAuthRepository({ auth: {}, authSdk }).changePassword({ email: 'a@x.com' }, 'vieja', 'nueva');
    expect(steps).toEqual([
      ['reauth', { email: 'a@x.com', password: 'vieja' }],
      ['update', 'nueva'],
    ]);
  });
});

describe('almacenamiento local', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const keys = { tasksKey: 'tareas-dev-u1', migratedKey: 'tareas-migradas-dev-u1', indexKey: 'lucas-indice-dev-u1' };

  it('LocalTaskCache guarda y lee las tareas, migrando formatos antiguos', () => {
    store.set(keys.tasksKey, JSON.stringify([{ id: 1, text: 'vieja', completed: true }, { basura: true }]));
    const cache = createLocalTaskCache(keys);
    expect(cache.load()).toEqual([expect.objectContaining({ id: '1', status: 'completed', order: 0 })]);

    expect(cache.save([task('n')])).toBe(true);
    expect(JSON.parse(store.get(keys.tasksKey))[0].id).toBe('n');
  });

  const event = (id, text = 'x') => ({ id, type: 'create', at: 1, text });

  it('LocalTaskCache guarda y lee el historial', () => {
    const cache = createLocalTaskCache(keys);
    expect(cache.save([task('a', { history: [event('e1')] }), task('b', { history: null })])).toBe(true);
    expect(cache.load().map((t) => t.history)).toEqual([[event('e1')], null]);
  });

  it('LocalTaskCache reintenta sin el historial si no cabe, y lo avisa', () => {
    // localStorage lleno: no acepta valores de más de 2 000 caracteres.
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        if (String(value).length > 2000) throw new DOMException('lleno', 'QuotaExceededError');
        store.set(key, String(value));
      },
    });
    const cache = createLocalTaskCache(keys);
    const tasks = [task('a', { history: [event('e1', 'y'.repeat(200)), event('e2', 'y'.repeat(200))] })];
    expect(cache.save(Array.from({ length: 4 }, (_, i) => ({ ...tasks[0], id: `t${i}` })))).toBe(SAVED_WITHOUT_HISTORY);
    const saved = cache.load();
    expect(saved.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3']);
    expect(saved.every((t) => t.history === null)).toBe(true);

    // Si ni sin historial caben, no se guarda nada.
    expect(
      cache.save(Array.from({ length: 30 }, (_, i) => task(`t${i}`, { text: 'z'.repeat(100), history: [] }))),
    ).toBe(false);
  });

  it('LocalTaskCache empieza vacío con datos corruptos', () => {
    store.set(keys.tasksKey, '{no es json');
    expect(createLocalTaskCache(keys).load()).toEqual([]);
    store.set(keys.tasksKey, '{"a":1}');
    expect(createLocalTaskCache(keys).load()).toEqual([]);
  });

  it('LocalTaskCache recuerda la migración', () => {
    const cache = createLocalTaskCache(keys);
    expect(cache.isMigrated()).toBe(false);
    cache.markMigrated();
    expect(cache.isMigrated()).toBe(true);
  });

  it('LocalTaskCache recuerda cuándo se completó el índice de tareas', () => {
    const cache = createLocalTaskCache(keys);
    expect(cache.isIndexComplete()).toBe(false);
    cache.markIndexComplete(1_790_000_000_000);
    expect(cache.isIndexComplete()).toBe(true);
    expect(store.get(keys.indexKey)).toBe('1790000000000');
  });

  it('sin localStorage no falla: no guarda y no migra', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    });
    const cache = createLocalTaskCache(keys);
    expect(cache.load()).toEqual([]);
    expect(cache.save([task('a')])).toBe(false);
    expect(cache.isMigrated()).toBe(true);
    // Sin marca el índice se vuelve a comprobar; no pasa nada si se repite.
    expect(cache.isIndexComplete()).toBe(false);
    expect(() => cache.markIndexComplete(1)).not.toThrow();

    const reminders = createReminderStore();
    reminders.markShown('2026-10-7@10');
    expect(reminders.lastShown()).toBe('2026-10-7@10');
  });

  it('ReminderStore recuerda el último turno mostrado', () => {
    const reminders = createReminderStore();
    expect(reminders.lastShown()).toBeNull();
    reminders.markShown('2026-10-7@15');
    expect(store.get('ultimo-recordatorio')).toBe('2026-10-7@15');
    expect(createReminderStore().lastShown()).toBe('2026-10-7@15');
  });
});
