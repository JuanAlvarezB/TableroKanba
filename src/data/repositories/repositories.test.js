import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { createAllowedUsersRepository } from './AllowedUsersRepository.js';
import { createFirebaseAuthRepository } from './FirebaseAuthRepository.js';
import { createFirestoreTaskRepository, toDocument } from './FirestoreTaskRepository.js';
import { createLocalTaskCache } from './LocalTaskCache.js';
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
  it('guarda la tarea con su dueño y sin el id ni las etiquetas vacías', async () => {
    const { db, fs, calls } = fakeFirestore();
    await createFirestoreTaskRepository({ db, fs }, 'uid-1').save(task('t1'));
    expect(calls).toEqual([
      [
        'set',
        'tasks/t1',
        { text: 't1', status: 'pending', order: 0, createdAt: 1, startedAt: null, completedAt: null, ownerId: 'uid-1' },
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

  it('remove y saveAll usan una sola escritura en lote', async () => {
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
          ['delete', 'tasks/b'],
        ],
      ],
      ['batch', [['set', 'tasks/c', expect.objectContaining({ ownerId: 'u' })]]],
    ]);
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

describe('AllowedUsersRepository', () => {
  const repo = (getDoc) => createAllowedUsersRepository({ db: 'db', fs: { doc: (db, c, id) => `${c}/${id}`, getDoc } });

  it('devuelve el nombre de la persona autorizada, o null si no lo está', async () => {
    const found = repo(async (ref) => ({ exists: () => true, data: () => ({ name: `  ${ref}  ` }) }));
    expect(await found.find('ana@x.com')).toEqual({ name: 'allowedUsers/ana@x.com' });

    const missing = repo(async () => ({ exists: () => false }));
    expect(await missing.find('nadie@x.com')).toBeNull();

    const noName = repo(async () => ({ exists: () => true, data: () => ({}) }));
    expect(await noName.find('a@x.com')).toEqual({ name: '' });
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

  const keys = { tasksKey: 'tareas-dev-u1', migratedKey: 'tareas-migradas-dev-u1' };

  it('LocalTaskCache guarda y lee las tareas, migrando formatos antiguos', () => {
    store.set(keys.tasksKey, JSON.stringify([{ id: 1, text: 'vieja', completed: true }, { basura: true }]));
    const cache = createLocalTaskCache(keys);
    expect(cache.load()).toEqual([expect.objectContaining({ id: '1', status: 'completed', order: 0 })]);

    expect(cache.save([task('n')])).toBe(true);
    expect(JSON.parse(store.get(keys.tasksKey))[0].id).toBe('n');
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
