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
  ...fields,
});

const SESSION = { uid: 'u-admin', email: 'Admin@Ejemplo.test', role: 'admin' };

// Repositorio falso: entrega la lista con push() y registra las escrituras.
function fakeRepository() {
  const repository = {
    writes: [],
    failWith: null,
    stop: vi.fn(),
    watch: vi.fn((onChange, onError) => {
      repository.push = onChange;
      repository.fail = onError;
      return repository.stop;
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

function setup(list = []) {
  const repository = fakeRepository();
  const store = createUsersStore({ newId: () => 'log-1' });
  const events = { change: 0, notice: [], error: [], 'access-lost': 0 };
  store.on('change', () => events.change++);
  store.on('notice', (text) => events.notice.push(text));
  store.on('error', (text) => events.error.push(text));
  store.on('access-lost', () => events['access-lost']++);
  store.connect(repository, SESSION);
  repository.push(list);
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

  it('disconnect deja de escuchar', () => {
    const { store, repository } = setup();
    store.disconnect();
    expect(repository.stop).toHaveBeenCalled();
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
