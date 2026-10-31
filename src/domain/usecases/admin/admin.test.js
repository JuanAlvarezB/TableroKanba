import { describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../../repositories/RepositoryError.js';
import { authorizeEmail } from './AuthorizeEmail.js';
import { cancelUserDeletion } from './CancelUserDeletion.js';
import { deactivateUser } from './DeactivateUser.js';
import { demoteUser } from './DemoteUser.js';
import { promoteUser } from './PromoteUser.js';
import { reactivateUser } from './ReactivateUser.js';
import { DELETION_CHUNK_SIZE, runUserDeletion } from './RunUserDeletion.js';
import { startUserDeletion } from './StartUserDeletion.js';

const person = (email, fields = {}) => ({
  email,
  name: `Nombre de ${email}`,
  role: 'member',
  active: true,
  uid: `uid-${email}`,
  permissions: {},
  deleting: false,
  doneLogId: null,
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

/* ---------- Eliminación en dos fases (2.5) ---------- */

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

// Inés: desactivada, miembro, con 21 tareas en el respaldo de hace una hora.
const ines = person('ines@ejemplo.test', { active: false, uid: 'u-ines' });
const ready = (fields = {}) => ({
  key: 'u-ines',
  state: 'backup-ready',
  taskCount: 21,
  backupAt: NOW - HOUR,
  ...fields,
});
const confirmed = { ...ines, deleting: true, doneLogId: 'fin-1' };
const deletingMarker = (fields = {}) => ready({ state: 'deleting', ...fields });
// Quien nunca entró: sin uid; el marcador usa su correo y no tiene tareas.
const nunca = person('nunca@ejemplo.test', { active: false, uid: null });
const nuncaMarker = (fields = {}) => ({ key: 'nunca@ejemplo.test', taskCount: 0, backupAt: NOW - HOUR, ...fields });

const taskIds = (count) => Array.from({ length: count }, (_, i) => `t${i}`);

// Repositorio falso de la eliminación: indexed son los documentos de taskIndex del "servidor" por
// uid; failOnChunk hace fallar ese trozo (contando desde 1) para probar la reanudación.
function fakeDeletionRepository({ indexed = {}, failOnChunk = null } = {}) {
  const server = Object.fromEntries(Object.entries(indexed).map(([uid, ids]) => [uid, [...ids]]));
  let chunks = 0;
  const repository = {
    writes: [],
    failOnChunk,
    async startDeletion(email, key, entry, doneLogId) {
      repository.writes.push(['startDeletion', email, key, entry, doneLogId]);
    },
    async cancelDeletion(key, entry) {
      repository.writes.push(['cancelDeletion', key, entry]);
    },
    async countIndexed(uid) {
      return (server[uid] ?? []).length;
    },
    async deleteTaskChunk(uid, limit) {
      chunks += 1;
      if (chunks === repository.failOnChunk) throw new RepositoryError('unavailable');
      const ids = (server[uid] ?? []).splice(0, limit);
      if (ids.length > 0) repository.writes.push(['deleteTaskChunk', uid, ids]);
      return { deleted: ids.length };
    },
    async finishDeletion(email, key, entry) {
      repository.writes.push(['finishDeletion', email, key, entry]);
    },
  };
  return repository;
}

function deletionDeps(adminUsers, extra = {}) {
  let count = 0;
  return { adminUsers, newId: () => `log-${++count}`, now: NOW, ...extra };
}

describe('startUserDeletion', () => {
  it('confirma con el correo escrito y escribe delete-start con el ID de delete-done aparte', async () => {
    const adminUsers = fakeDeletionRepository();
    const input = { marker: ready(), confirmation: ' Ines@Ejemplo.TEST ' };
    expect(await startUserDeletion(admin, ines, input, deletionDeps(adminUsers))).toEqual({
      ok: true,
      doneLogId: 'log-2',
    });
    expect(adminUsers.writes).toEqual([
      [
        'startDeletion',
        'ines@ejemplo.test',
        'u-ines',
        { id: 'log-1', action: 'delete-start', actorUid: 'u-admin', targetUid: 'u-ines', detail: { taskCount: 21 } },
        'log-2',
      ],
    ]);
    expectNoPersonalData(adminUsers.writes[0][3]);
  });

  it('a quien nunca entró la confirma con el marcador por correo y sin uid en el registro', async () => {
    const adminUsers = fakeDeletionRepository();
    const input = { marker: nuncaMarker({ state: 'backup-ready' }), confirmation: 'nunca@ejemplo.test' };
    expect(await startUserDeletion(admin, nunca, input, deletionDeps(adminUsers))).toMatchObject({ ok: true });
    const [, , key, entry] = adminUsers.writes[0];
    expect(key).toBe('nunca@ejemplo.test');
    expect(entry).toMatchObject({ targetUid: null, detail: { taskCount: 0 } });
  });

  it.each([
    ['la persona está activa', admin, { ...ines, active: true }, ready(), 'target-active'],
    ['es administradora', admin, { ...ines, role: 'admin' }, ready(), 'target-is-admin'],
    ['es uno mismo', admin, admin, ready({ key: 'u-admin' }), 'self'],
    ['actúa un miembro', ana, ines, ready(), 'not-admin'],
    ['ya está en eliminación', admin, confirmed, ready(), 'in-deletion'],
    ['no hay marcador', admin, ines, null, 'no-backup'],
    ['el marcador es de otra persona', admin, ines, ready({ key: 'u-otra' }), 'no-backup'],
    ['el marcador ya está confirmado', admin, ines, deletingMarker(), 'no-backup'],
    ['el respaldo tiene 24 horas o más', admin, ines, ready({ backupAt: NOW - 24 * HOUR }), 'backup-stale'],
  ])('se rechaza sin escribir si %s', async (_, actor, target, marker, reason) => {
    const adminUsers = fakeDeletionRepository();
    const input = { marker, confirmation: target.email };
    expect(await startUserDeletion(actor, target, input, deletionDeps(adminUsers))).toEqual({ ok: false, reason });
    expect(adminUsers.writes).toEqual([]);
  });

  it('se rechaza si el correo escrito no coincide', async () => {
    const adminUsers = fakeDeletionRepository();
    const input = { marker: ready(), confirmation: 'ines@ejemplo.tes' };
    expect(await startUserDeletion(admin, ines, input, deletionDeps(adminUsers))).toEqual({
      ok: false,
      reason: 'email-mismatch',
    });
    expect(adminUsers.writes).toEqual([]);
  });

  it('los fallos de infraestructura llegan como RepositoryError', async () => {
    const adminUsers = fakeDeletionRepository();
    adminUsers.startDeletion = async () => {
      throw new RepositoryError('permission-denied');
    };
    const input = { marker: ready(), confirmation: ines.email };
    await expect(startUserDeletion(admin, ines, input, deletionDeps(adminUsers))).rejects.toMatchObject({
      reason: 'permission-denied',
    });
  });
});

describe('runUserDeletion', () => {
  it('borra por trozos de 8 con su avance y cierra con delete-done', async () => {
    const adminUsers = fakeDeletionRepository({ indexed: { 'u-ines': taskIds(21) } });
    const onProgress = vi.fn();
    expect(await runUserDeletion(admin, confirmed, deletingMarker(), { adminUsers, onProgress })).toEqual({
      ok: true,
      total: 21,
    });
    expect(DELETION_CHUNK_SIZE).toBe(8);
    expect(adminUsers.writes.map(([type, , ids]) => (type === 'deleteTaskChunk' ? ids.length : type))).toEqual([
      8,
      8,
      5,
      'finishDeletion',
    ]);
    expect(onProgress.mock.calls.map(([progress]) => progress.done)).toEqual([0, 8, 16, 21]);
    const entry = adminUsers.writes.at(-1)[3];
    expect(adminUsers.writes.at(-1).slice(0, 3)).toEqual(['finishDeletion', 'ines@ejemplo.test', 'u-ines']);
    expect(entry).toEqual({
      id: 'fin-1',
      action: 'delete-done',
      actorUid: 'u-admin',
      targetUid: 'u-ines',
      detail: { taskCount: 21 },
    });
    expectNoPersonalData(entry);
  });

  it('si falla a mitad no cierra, y al reanudar sigue desde lo que queda', async () => {
    const adminUsers = fakeDeletionRepository({ indexed: { 'u-ines': taskIds(21) }, failOnChunk: 2 });
    const first = vi.fn();
    await expect(
      runUserDeletion(admin, confirmed, deletingMarker(), { adminUsers, onProgress: first }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(first.mock.calls.at(-1)[0]).toEqual({ done: 8, total: 21 });
    expect(adminUsers.writes.some(([type]) => type === 'finishDeletion')).toBe(false);

    const resumed = vi.fn();
    expect(await runUserDeletion(admin, confirmed, deletingMarker(), { adminUsers, onProgress: resumed })).toEqual({
      ok: true,
      total: 21,
    });
    expect(resumed.mock.calls.map(([progress]) => progress.done)).toEqual([8, 16, 21]);
    expect(adminUsers.writes.filter(([type]) => type === 'finishDeletion')).toHaveLength(1);
  });

  it('reanudar cuando ya no quedan tareas solo cierra', async () => {
    const adminUsers = fakeDeletionRepository({ indexed: { 'u-ines': [] } });
    expect(await runUserDeletion(admin, confirmed, deletingMarker(), { adminUsers })).toEqual({ ok: true, total: 21 });
    expect(adminUsers.writes.map(([type]) => type)).toEqual(['finishDeletion']);
  });

  it('a quien nunca entró solo le borra el documento y el marcador', async () => {
    const adminUsers = fakeDeletionRepository();
    adminUsers.countIndexed = vi.fn();
    const target = { ...nunca, deleting: true, doneLogId: 'fin-1' };
    const marker = nuncaMarker({ state: 'deleting' });
    expect(await runUserDeletion(admin, target, marker, { adminUsers })).toEqual({ ok: true, total: 0 });
    expect(adminUsers.countIndexed).not.toHaveBeenCalled();
    expect(adminUsers.writes).toEqual([
      [
        'finishDeletion',
        'nunca@ejemplo.test',
        'nunca@ejemplo.test',
        { id: 'fin-1', action: 'delete-done', actorUid: 'u-admin', targetUid: null, detail: { taskCount: 0 } },
      ],
    ]);
  });

  it('con más índices que tareas en el respaldo no borra nada', async () => {
    const adminUsers = fakeDeletionRepository({ indexed: { 'u-ines': taskIds(22) } });
    expect(await runUserDeletion(admin, confirmed, deletingMarker(), { adminUsers })).toEqual({
      ok: false,
      reason: 'leftovers',
    });
    expect(adminUsers.writes).toEqual([]);
  });

  it('si lo borrado no cuadra con el respaldo o el servidor aún tiene índices, no cierra', async () => {
    // Aparecieron índices durante el borrado: se borraron más de los que había al empezar.
    const grew = fakeDeletionRepository({ indexed: { 'u-ines': taskIds(3) } });
    grew.countIndexed = vi.fn().mockResolvedValueOnce(2).mockResolvedValue(0);
    const marker = deletingMarker({ taskCount: 3 });
    expect(await runUserDeletion(admin, confirmed, marker, { adminUsers: grew })).toEqual({
      ok: false,
      reason: 'leftovers',
    });
    expect(grew.writes.some(([type]) => type === 'finishDeletion')).toBe(false);

    // El conteo final del servidor no da 0.
    const left = fakeDeletionRepository({ indexed: { 'u-ines': taskIds(3) } });
    left.countIndexed = vi.fn().mockResolvedValueOnce(3).mockResolvedValue(1);
    expect(await runUserDeletion(admin, confirmed, marker, { adminUsers: left })).toEqual({
      ok: false,
      reason: 'leftovers',
    });
    expect(left.writes.some(([type]) => type === 'finishDeletion')).toBe(false);
  });

  it('quien nunca entró con tareas en el marcador no se cierra', async () => {
    const adminUsers = fakeDeletionRepository();
    const target = { ...nunca, deleting: true, doneLogId: 'fin-1' };
    const marker = nuncaMarker({ state: 'deleting', taskCount: 2 });
    expect(await runUserDeletion(admin, target, marker, { adminUsers })).toEqual({ ok: false, reason: 'leftovers' });
    expect(adminUsers.writes).toEqual([]);
  });

  it.each([
    ['la persona no tiene la marca', admin, ines, deletingMarker(), 'not-confirmed'],
    ['falta el ID de delete-done', admin, { ...confirmed, doneLogId: null }, deletingMarker(), 'not-confirmed'],
    ['el marcador sigue en backup-ready', admin, confirmed, ready(), 'not-confirmed'],
    ['no hay marcador', admin, confirmed, null, 'not-confirmed'],
    ['el marcador es de otra persona', admin, confirmed, deletingMarker({ key: 'u-otra' }), 'not-confirmed'],
    ['actúa un miembro', ana, confirmed, deletingMarker(), 'not-admin'],
    ['es uno mismo', admin, { ...admin, deleting: true, doneLogId: 'fin-1' }, deletingMarker(), 'self'],
  ])('no borra nada si %s', async (_, actor, target, marker, reason) => {
    const adminUsers = fakeDeletionRepository({ indexed: { 'u-ines': taskIds(3) } });
    expect(await runUserDeletion(actor, target, marker, { adminUsers })).toEqual({ ok: false, reason });
    expect(adminUsers.writes).toEqual([]);
  });
});

describe('cancelUserDeletion', () => {
  it('borra el marcador del respaldo y escribe delete-cancel', async () => {
    const adminUsers = fakeDeletionRepository();
    expect(await cancelUserDeletion(admin, ines, ready(), deletionDeps(adminUsers))).toEqual({ ok: true });
    expect(adminUsers.writes).toEqual([
      ['cancelDeletion', 'u-ines', { id: 'log-1', action: 'delete-cancel', actorUid: 'u-admin', targetUid: 'u-ines' }],
    ]);
  });

  it('también si la persona se reactivó después del respaldo', async () => {
    const adminUsers = fakeDeletionRepository();
    expect(await cancelUserDeletion(admin, { ...ines, active: true }, ready(), deletionDeps(adminUsers))).toEqual({
      ok: true,
    });
  });

  it.each([
    ['ya está confirmada', admin, confirmed, deletingMarker(), 'in-deletion'],
    ['no hay marcador', admin, ines, null, 'no-backup'],
    ['el marcador ya está confirmado', admin, ines, deletingMarker(), 'no-backup'],
    ['es uno mismo', admin, admin, ready({ key: 'u-admin' }), 'self'],
    ['actúa un miembro', ana, ines, ready(), 'not-admin'],
  ])('se rechaza sin escribir si %s', async (_, actor, target, marker, reason) => {
    const adminUsers = fakeDeletionRepository();
    expect(await cancelUserDeletion(actor, target, marker, deletionDeps(adminUsers))).toEqual({ ok: false, reason });
    expect(adminUsers.writes).toEqual([]);
  });
});
