import { describe, expect, it } from 'vitest';
import { RepositoryError } from '../../repositories/RepositoryError.js';
import { authorizeEmail } from './AuthorizeEmail.js';
import { deactivateUser } from './DeactivateUser.js';
import { demoteUser } from './DemoteUser.js';
import { promoteUser } from './PromoteUser.js';
import { reactivateUser } from './ReactivateUser.js';

const person = (email, fields = {}) => ({
  email,
  name: `Nombre de ${email}`,
  role: 'member',
  active: true,
  uid: `uid-${email}`,
  permissions: {},
  deleting: false,
  ...fields,
});

const admin = person('admin@ejemplo.test', { role: 'admin', uid: 'u-admin' });
const ana = person('ana@ejemplo.test', { uid: 'u-ana' });

// Repositorio falso: guarda lo que se escribiría y puede simular que el correo ya existe o un fallo.
function fakeAdminUsers({ existing = [], failWith = null } = {}) {
  const writes = [];
  return {
    writes,
    async create(user, entry) {
      if (failWith) throw failWith;
      if (existing.includes(user.email)) throw new RepositoryError('already-exists');
      writes.push(['create', user, entry]);
    },
    async update(email, fields, entry) {
      if (failWith) throw failWith;
      writes.push(['update', email, fields, entry]);
    },
  };
}

const deps = (adminUsers) => ({ adminUsers, newId: () => 'log-1' });

// Ninguna entrada del registro lleva correos ni nombres (2.7).
function expectNoPersonalData(entry) {
  const text = JSON.stringify(entry);
  expect(text).not.toMatch(/@/);
  expect(text).not.toMatch(/Nombre de|Ana/);
}

describe('authorizeEmail', () => {
  it('normaliza el correo y crea el documento con su entrada authorize, sin uid de la persona', async () => {
    const adminUsers = fakeAdminUsers();
    const result = await authorizeEmail(
      admin,
      { email: ' Ana@Ejemplo.TEST ', name: ' Ana ', role: 'member' },
      deps(adminUsers),
    );
    expect(result).toEqual({ ok: true, email: 'ana@ejemplo.test' });
    expect(adminUsers.writes).toEqual([
      [
        'create',
        { email: 'ana@ejemplo.test', name: 'Ana', role: 'member' },
        { id: 'log-1', action: 'authorize', actorUid: 'u-admin', targetUid: null, detail: { role: 'member' } },
      ],
    ]);
    expectNoPersonalData(adminUsers.writes[0][2]);
  });

  it('un correo ya autorizado no se sobrescribe', async () => {
    const adminUsers = fakeAdminUsers({ existing: ['ana@ejemplo.test'] });
    const result = await authorizeEmail(
      admin,
      { email: 'ana@ejemplo.test', name: 'Ana', role: 'admin' },
      deps(adminUsers),
    );
    expect(result).toEqual({ ok: false, reason: 'already-authorized' });
    expect(adminUsers.writes).toEqual([]);
  });

  it.each([
    [{ email: 'ana', name: 'Ana', role: 'member' }, 'invalid-email'],
    [{ email: 'ana@ejemplo.test', name: '', role: 'member' }, 'missing-name'],
    [{ email: 'ana@ejemplo.test', name: 'Ana', role: 'root' }, 'unknown-role'],
    [{ email: 'ADMIN@ejemplo.test', name: 'Yo', role: 'member' }, 'self'],
  ])('rechaza %j sin escribir: %s', async (input, reason) => {
    const adminUsers = fakeAdminUsers();
    expect(await authorizeEmail(admin, input, deps(adminUsers))).toEqual({ ok: false, reason });
    expect(adminUsers.writes).toEqual([]);
  });

  it('un miembro o un administrador inactivo no autoriza', async () => {
    const input = { email: 'b@ejemplo.test', name: 'B', role: 'member' };
    expect(await authorizeEmail(ana, input, deps(fakeAdminUsers()))).toEqual({ ok: false, reason: 'not-admin' });
    const inactive = { ...admin, active: false };
    expect(await authorizeEmail(inactive, input, deps(fakeAdminUsers()))).toEqual({ ok: false, reason: 'not-admin' });
  });

  it('los fallos de infraestructura llegan como RepositoryError', async () => {
    const adminUsers = fakeAdminUsers({ failWith: new RepositoryError('permission-denied') });
    await expect(
      authorizeEmail(admin, { email: 'b@ejemplo.test', name: 'B', role: 'member' }, deps(adminUsers)),
    ).rejects.toMatchObject({ reason: 'permission-denied' });
  });
});

describe('cambios sobre otra persona', () => {
  const cases = [
    ['deactivateUser', deactivateUser, ana, { active: false }, 'deactivate', undefined],
    ['reactivateUser', reactivateUser, { ...ana, active: false }, { active: true }, 'reactivate', undefined],
    ['promoteUser', promoteUser, ana, { role: 'admin' }, 'promote', { from: 'member', to: 'admin' }],
    [
      'demoteUser',
      demoteUser,
      { ...ana, role: 'admin' },
      { role: 'member' },
      'demote',
      { from: 'admin', to: 'member' },
    ],
  ];

  it.each(cases)(
    '%s escribe el cambio y su entrada en la misma operación',
    async (_, run, target, fields, action, detail) => {
      const adminUsers = fakeAdminUsers();
      expect(await run(admin, target, deps(adminUsers))).toEqual({ ok: true });
      expect(adminUsers.writes).toEqual([
        [
          'update',
          'ana@ejemplo.test',
          fields,
          { id: 'log-1', action, actorUid: 'u-admin', targetUid: 'u-ana', ...(detail && { detail }) },
        ],
      ]);
      expectNoPersonalData(adminUsers.writes[0][3]);
    },
  );

  it.each(cases)('%s no se aplica a uno mismo', async (_, run) => {
    const adminUsers = fakeAdminUsers();
    expect(await run(admin, admin, deps(adminUsers))).toEqual({ ok: false, reason: 'self' });
    expect(adminUsers.writes).toEqual([]);
  });

  it.each(cases)('%s no lo hace un miembro', async (_, run, target) => {
    const adminUsers = fakeAdminUsers();
    expect(await run(person('m@ejemplo.test'), target, deps(adminUsers))).toEqual({ ok: false, reason: 'not-admin' });
    expect(adminUsers.writes).toEqual([]);
  });

  it.each(cases)('%s no se aplica a una persona en eliminación', async (_, run, target) => {
    const adminUsers = fakeAdminUsers();
    const deleting = { ...target, active: false, deleting: true };
    expect(await run(admin, deleting, deps(adminUsers))).toEqual({ ok: false, reason: 'in-deletion' });
    expect(adminUsers.writes).toEqual([]);
  });

  it('si otro administrador ya hizo el cambio, no escribe nada', async () => {
    const adminUsers = fakeAdminUsers();
    expect(await deactivateUser(admin, { ...ana, active: false }, deps(adminUsers))).toEqual({
      ok: true,
      unchanged: true,
    });
    expect(await promoteUser(admin, { ...ana, role: 'admin' }, deps(adminUsers))).toEqual({
      ok: true,
      unchanged: true,
    });
    expect(adminUsers.writes).toEqual([]);
  });

  it('se puede promover o degradar a una persona inactiva', async () => {
    const adminUsers = fakeAdminUsers();
    expect(await promoteUser(admin, { ...ana, active: false }, deps(adminUsers))).toEqual({ ok: true });
    expect(await demoteUser(admin, { ...ana, active: false, role: 'admin' }, deps(adminUsers))).toEqual({ ok: true });
  });

  it('una persona que nunca ha entrado queda en el registro sin uid', async () => {
    const adminUsers = fakeAdminUsers();
    await deactivateUser(admin, { ...ana, uid: null }, deps(adminUsers));
    expect(adminUsers.writes[0][3].targetUid).toBeNull();
  });
});
