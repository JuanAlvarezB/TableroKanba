import { describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../../domain/repositories/RepositoryError.js';
import { USERS_MESSAGES } from '../../shared/constants/messages.js';
import { createUsersStore } from './usersStore.js';

const person = (email, fields = {}) => ({
  email,
  name: email.split('@')[0],
  role: 'member',
  active: true,
  uid: `uid-${email}`,
  permissions: {},
  deleting: false,
  doneLogId: null,
  ...fields,
});

const SESSION = { uid: 'u-admin', email: 'Admin@Ejemplo.test', role: 'admin' };

// Repositorio falso: entrega la lista con push() y los marcadores con pushMarkers(), y registra las
// escrituras. indexed son los IDs de taskIndex de cada uid; failOnChunk hace fallar ese trozo.
function fakeRepository() {
  const repository = {
    writes: [],
    failWith: null,
    indexed: {},
    failOnChunk: null,
    chunks: 0,
    stop: vi.fn(),
    stopMarkers: vi.fn(),
    watch: vi.fn((onChange, onError) => {
      repository.push = onChange;
      repository.fail = onError;
      return repository.stop;
    }),
    watchDeletions: vi.fn((onChange, onError) => {
      repository.pushMarkers = onChange;
      repository.failMarkers = onError;
      return repository.stopMarkers;
    }),
    startDeletion: vi.fn(async (email, key, entry, doneLogId) => {
      if (repository.failWith) throw repository.failWith;
      repository.writes.push(['startDeletion', email, key, entry.action, doneLogId]);
    }),
    cancelDeletion: vi.fn(async (key, entry) => {
      repository.writes.push(['cancelDeletion', key, entry.action]);
    }),
    countIndexed: vi.fn(async (uid) => (repository.indexed[uid] ?? []).length),
    deleteTaskChunk: vi.fn(async (uid, limit) => {
      repository.chunks += 1;
      if (repository.chunks === repository.failOnChunk) throw new RepositoryError('unavailable');
      const ids = (repository.indexed[uid] ?? []).splice(0, limit);
      return { deleted: ids.length };
    }),
    finishDeletion: vi.fn(async (email, key, entry) => {
      repository.writes.push(['finishDeletion', email, key, entry.action, entry.id]);
    }),
    create: vi.fn(async (user, entry) => {
      if (repository.failWith) throw repository.failWith;
      repository.writes.push(['create', user, entry]);
    }),
    update: vi.fn(async (email, fields, entry) => {
      if (repository.failWith) throw repository.failWith;
      repository.writes.push(['update', email, fields, entry]);
    }),
  };
  return repository;
}

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function setup(list = [], { markers = null, newId = () => 'log-1' } = {}) {
  const repository = fakeRepository();
  const store = createUsersStore({ newId, now: () => NOW });
  const events = { change: 0, notice: [], error: [], 'access-lost': 0, progress: [] };
  store.on('change', () => events.change++);
  store.on('notice', (text) => events.notice.push(text));
  store.on('error', (text) => events.error.push(text));
  store.on('access-lost', () => events['access-lost']++);
  store.on('progress', (progress) => events.progress.push(progress));
  store.connect(repository, SESSION);
  repository.push(list);
  if (markers) repository.pushMarkers(markers);
  return { store, repository, events };
}

const admin = person('admin@ejemplo.test', { name: 'Admin', role: 'admin', uid: 'u-admin' });

describe('usersStore: lista', () => {
  it('ordena por nombre, marca la fila propia y su estado', () => {
    const { store, events } = setup([
      person('zoe@ejemplo.test', { name: 'Zoe' }),
      admin,
      person('bea@ejemplo.test', { name: 'Bea', active: false }),
    ]);
    expect(store.isLoaded()).toBe(true);
    expect(events.change).toBe(1);
    expect(store.rows().map((row) => [row.user.name, row.lifecycle, row.self])).toEqual([
      ['Admin', 'active', true],
      ['Bea', 'inactive', false],
      ['Zoe', 'active', false],
    ]);
  });

  it('filtra por estado o rol y busca por nombre o correo sin importar tildes ni mayúsculas', () => {
    const { store } = setup([
      admin,
      person('jose@ejemplo.test', { name: 'José Pérez' }),
      person('bea@ejemplo.test', { name: 'Bea', active: false }),
      person('elena@ejemplo.test', { name: 'Elena', active: false, deleting: true }),
    ]);
    const names = () => store.rows().map((row) => row.user.name);

    store.setFilter('inactive');
    expect(names()).toEqual(['Bea']);
    store.setFilter('deleting');
    expect(names()).toEqual(['Elena']);
    store.setFilter('admin');
    expect(names()).toEqual(['Admin']);
    store.setFilter('active');
    expect(names()).toEqual(['Admin', 'José Pérez']);
    store.setFilter('nada');
    expect(store.filter()).toBe('active');

    store.setFilter('all');
    store.setQuery('  JOSE ');
    expect(names()).toEqual(['José Pérez']);
    store.setQuery('bea@');
    expect(names()).toEqual(['Bea']);
    expect(store.total()).toBe(4);
  });

  it('un error de permisos al escuchar avisa y pide revalidar la sesión', () => {
    const { repository, events } = setup();
    repository.fail(new RepositoryError('permission-denied'));
    expect(events.error).toEqual([USERS_MESSAGES.permissionDenied]);
    expect(events['access-lost']).toBe(1);
    repository.fail(new RepositoryError('unavailable'));
    expect(events.error[1]).toBe(USERS_MESSAGES.unavailable);
    expect(events['access-lost']).toBe(1);
  });

  it('disconnect deja de escuchar la lista y los marcadores', () => {
    const { store, repository } = setup();
    store.disconnect();
    expect(repository.stop).toHaveBeenCalled();
    expect(repository.stopMarkers).toHaveBeenCalled();
  });

  it('cada fila lleva su marcador; el respaldo está listo solo sin confirmar y con menos de 24 horas', () => {
    const { store, events } = setup(
      [
        admin,
        person('bea@ejemplo.test', { name: 'Bea', active: false, uid: 'u-bea' }),
        person('ceci@ejemplo.test', { name: 'Ceci', active: false, uid: null }),
        person('dani@ejemplo.test', { name: 'Dani', active: false, uid: 'u-dani' }),
        person('eva@ejemplo.test', { name: 'Eva', active: false, uid: 'u-eva', deleting: true }),
      ],
      {
        markers: [
          { key: 'u-bea', state: 'backup-ready', taskCount: 4, backupAt: NOW - HOUR },
          { key: 'ceci@ejemplo.test', state: 'backup-ready', taskCount: 0, backupAt: NOW - HOUR },
          { key: 'u-dani', state: 'backup-ready', taskCount: 2, backupAt: NOW - 25 * HOUR },
          { key: 'u-eva', state: 'deleting', taskCount: 9, backupAt: NOW - HOUR },
        ],
      },
    );
    expect(events.change).toBe(2);
    expect(store.rows().map((row) => [row.user.name, row.marker?.taskCount ?? null, row.backupReady])).toEqual([
      ['Admin', null, false],
      ['Bea', 4, true],
      ['Ceci', 0, true],
      ['Dani', 2, false],
      ['Eva', 9, false],
    ]);
  });

  it('un error al escuchar los marcadores se trata como el de la lista', () => {
    const { repository, events } = setup();
    repository.failMarkers(new RepositoryError('permission-denied'));
    expect(events.error).toEqual([USERS_MESSAGES.permissionDenied]);
    expect(events['access-lost']).toBe(1);
  });

  it('sessionEmail es el correo de la sesión en minúsculas', () => {
    expect(setup().store.sessionEmail()).toBe('admin@ejemplo.test');
  });
});

describe('usersStore: acciones', () => {
  it('autoriza un correo con el uid de la sesión y avisa', async () => {
    const { store, repository, events } = setup([admin]);
    const result = await store.authorize({ email: 'Ana@Ejemplo.test', name: 'Ana', role: 'member' });
    expect(result).toEqual({ ok: true, message: USERS_MESSAGES.done.authorize });
    expect(events.notice).toEqual([USERS_MESSAGES.done.authorize]);
    expect(repository.writes[0]).toEqual([
      'create',
      { email: 'ana@ejemplo.test', name: 'Ana', role: 'member' },
      { id: 'log-1', action: 'authorize', actorUid: 'u-admin', targetUid: null, detail: { role: 'member' } },
    ]);
  });

  it('dar el rol de administrador exige confirmar la advertencia', async () => {
    const { store, repository } = setup([admin]);
    const input = { email: 'ana@ejemplo.test', name: 'Ana', role: 'admin' };
    expect(await store.authorize(input)).toMatchObject({ ok: false, reason: 'admin-not-confirmed' });
    expect(repository.writes).toEqual([]);
    expect(await store.authorize({ ...input, adminConfirmed: true })).toMatchObject({ ok: true });
  });

  it('traduce los rechazos del dominio a texto', async () => {
    const { store, repository } = setup([admin]);
    repository.failWith = new RepositoryError('already-exists');
    expect(await store.authorize({ email: 'ana@ejemplo.test', name: 'Ana', role: 'member' })).toEqual({
      ok: false,
      reason: 'already-authorized',
      message: 'Ese correo ya está autorizado.',
    });
    expect(await store.authorize({ email: 'ana', name: 'Ana', role: 'member' })).toMatchObject({
      message: 'Escribe un correo válido.',
    });
  });

  it.each([
    ['deactivate', person('ana@ejemplo.test'), { active: false }, 'Acceso desactivado.'],
    ['reactivate', person('ana@ejemplo.test', { active: false }), { active: true }, 'Acceso reactivado.'],
    ['promote', person('ana@ejemplo.test'), { role: 'admin' }, 'Rol de administrador concedido.'],
    ['demote', person('ana@ejemplo.test', { role: 'admin' }), { role: 'member' }, 'Rol de administrador retirado.'],
  ])('%s escribe sobre el estado actual de la persona y avisa', async (action, target, fields, message) => {
    const { store, repository, events } = setup([admin, target]);
    expect(await store.change(action, 'ana@ejemplo.test')).toEqual({ ok: true, message });
    expect(repository.writes).toEqual([
      ['update', 'ana@ejemplo.test', fields, expect.objectContaining({ id: 'log-1', action, actorUid: 'u-admin' })],
    ]);
    expect(events.notice).toEqual([message]);
  });

  it('la propia fila no admite cambios', async () => {
    const { store, repository } = setup([admin]);
    expect(await store.change('deactivate', 'admin@ejemplo.test')).toMatchObject({
      ok: false,
      reason: 'self',
      message: 'No puedes cambiar tu propio rol ni tu estado, ni eliminarte.',
    });
    expect(repository.writes).toEqual([]);
  });

  it('si otro administrador quitó el rol a quien actúa, no escribe y revalida la sesión', async () => {
    const { store, repository, events } = setup([{ ...admin, role: 'member' }, person('ana@ejemplo.test')]);
    expect(await store.change('deactivate', 'ana@ejemplo.test')).toMatchObject({ ok: false, reason: 'not-admin' });
    expect(repository.writes).toEqual([]);
    expect(events['access-lost']).toBe(1);
  });

  it('una persona que ya no está en la lista o en eliminación no se cambia', async () => {
    const { store } = setup([admin, person('e@ejemplo.test', { active: false, deleting: true })]);
    expect(await store.change('reactivate', 'nadie@ejemplo.test')).toMatchObject({ reason: 'not-found' });
    expect(await store.change('reactivate', 'e@ejemplo.test')).toMatchObject({
      message: 'Esa persona está en eliminación. Termina o cancela la eliminación primero.',
    });
  });

  it('permission-denied del servidor avisa y pide revalidar; sin conexión solo avisa', async () => {
    const { store, repository, events } = setup([admin, person('ana@ejemplo.test')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    repository.failWith = new RepositoryError('permission-denied');
    expect(await store.change('deactivate', 'ana@ejemplo.test')).toEqual({
      ok: false,
      reason: 'permission-denied',
      message: USERS_MESSAGES.permissionDenied,
    });
    expect(events['access-lost']).toBe(1);

    repository.failWith = new RepositoryError('unavailable');
    expect(await store.change('deactivate', 'ana@ejemplo.test')).toMatchObject({ message: USERS_MESSAGES.unavailable });
    expect(events['access-lost']).toBe(1);
    expect(events.notice).toEqual([]);
  });
});

describe('usersStore: eliminar', () => {
  const bea = person('bea@ejemplo.test', { name: 'Bea', active: false, uid: 'u-bea' });
  const ready = { key: 'u-bea', state: 'backup-ready', taskCount: 10, backupAt: NOW - HOUR };
  const ids = (count) => Array.from({ length: count }, (_, i) => `t${i}`);

  function deletionSetup(list = [admin, bea], markers = [ready]) {
    let count = 0;
    const context = setup(list, { markers, newId: () => `log-${++count}` });
    context.repository.indexed['u-bea'] = ids(10);
    return context;
  }

  it('confirma con el correo escrito, borra con su avance y termina sin otro aviso', async () => {
    const { store, repository, events } = deletionSetup();
    expect(await store.deleteUser('bea@ejemplo.test', ' Bea@Ejemplo.test')).toEqual({
      ok: true,
      message: USERS_MESSAGES.done.delete,
    });
    expect(repository.writes).toEqual([
      ['startDeletion', 'bea@ejemplo.test', 'u-bea', 'delete-start', 'log-2'],
      ['finishDeletion', 'bea@ejemplo.test', 'u-bea', 'delete-done', 'log-2'],
    ]);
    expect(events.progress).toEqual([
      { email: 'bea@ejemplo.test', done: 0, total: 10 },
      { email: 'bea@ejemplo.test', done: 8, total: 10 },
      { email: 'bea@ejemplo.test', done: 10, total: 10 },
    ]);
    expect(events.notice).toEqual([]);
  });

  it('si el correo no coincide o el respaldo venció, no escribe nada', async () => {
    const { store, repository } = deletionSetup();
    expect(await store.deleteUser('bea@ejemplo.test', 'bea@ejemplo.tes')).toEqual({
      ok: false,
      reason: 'email-mismatch',
      message: 'El correo escrito no coincide.',
    });
    repository.pushMarkers([{ ...ready, backupAt: NOW - 24 * HOUR }]);
    expect(await store.deleteUser('bea@ejemplo.test', 'bea@ejemplo.test')).toMatchObject({
      message: 'El respaldo tiene más de 24 horas. Vuelve a ejecutarlo.',
    });
    repository.pushMarkers([]);
    expect(await store.deleteUser('bea@ejemplo.test', 'bea@ejemplo.test')).toMatchObject({
      message: 'Falta el respaldo verificado. Ejecuta el script de respaldo y vuelve aquí.',
    });
    expect(repository.writes).toEqual([]);
  });

  it('si se corta a medias dice cuánto se borró, y Reanudar termina', async () => {
    const { store, repository, events } = deletionSetup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    repository.failOnChunk = 2;
    expect(await store.deleteUser('bea@ejemplo.test', 'bea@ejemplo.test')).toEqual({
      ok: false,
      reason: 'unavailable',
      message: `${USERS_MESSAGES.unavailable} Se borraron 8 de 10 tareas. Pulsa Reanudar eliminación para terminar.`,
    });
    expect(events['access-lost']).toBe(0);

    // La escucha trae a la persona y el marcador ya confirmados.
    repository.push([admin, { ...bea, deleting: true, doneLogId: 'log-2' }]);
    repository.pushMarkers([{ ...ready, state: 'deleting' }]);
    events.progress.length = 0;
    expect(await store.resumeDeletion('bea@ejemplo.test')).toEqual({ ok: true, message: USERS_MESSAGES.done.delete });
    expect(events.progress.map(({ done }) => done)).toEqual([8, 10]);
    expect(repository.writes.at(-1)).toEqual(['finishDeletion', 'bea@ejemplo.test', 'u-bea', 'delete-done', 'log-2']);
  });

  it('con datos que no cuadran con el respaldo no termina y pide la limpieza', async () => {
    const { store, repository } = deletionSetup(
      [admin, { ...bea, deleting: true, doneLogId: 'log-9' }],
      [{ ...ready, state: 'deleting' }],
    );
    repository.indexed['u-bea'] = ids(11);
    expect(await store.resumeDeletion('bea@ejemplo.test')).toEqual({
      ok: false,
      reason: 'leftovers',
      message: USERS_MESSAGES.reasons.leftovers,
    });
    expect(repository.writes).toEqual([]);
  });

  it('si el servidor rechaza la confirmación, revalida la sesión', async () => {
    const { store, repository, events } = deletionSetup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    repository.failWith = new RepositoryError('permission-denied');
    expect(await store.deleteUser('bea@ejemplo.test', 'bea@ejemplo.test')).toMatchObject({
      reason: 'permission-denied',
      message: USERS_MESSAGES.permissionDenied,
    });
    expect(events['access-lost']).toBe(1);
    expect(repository.finishDeletion).not.toHaveBeenCalled();
  });

  it('cancelar descarta el respaldo y avisa', async () => {
    const { store, repository, events } = deletionSetup();
    expect(await store.cancelDeletion('bea@ejemplo.test')).toEqual({ ok: true, message: 'Eliminación cancelada.' });
    expect(repository.writes).toEqual([['cancelDeletion', 'u-bea', 'delete-cancel']]);
    expect(events.notice).toEqual(['Eliminación cancelada.']);
  });

  it('una persona que ya no está en la lista no se elimina ni se cancela', async () => {
    const { store } = deletionSetup();
    expect(await store.deleteUser('nadie@ejemplo.test', 'nadie@ejemplo.test')).toMatchObject({ reason: 'not-found' });
    expect(await store.resumeDeletion('nadie@ejemplo.test')).toMatchObject({ reason: 'not-found' });
    expect(await store.cancelDeletion('nadie@ejemplo.test')).toMatchObject({ reason: 'not-found' });
  });
});
