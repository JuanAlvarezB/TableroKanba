import { describe, expect, it } from 'vitest';
import { deletionKey, markerFromData, userFromData } from './User.js';

describe('userFromData', () => {
  it('un documento legado (solo name) es un miembro activo que nunca ha entrado', () => {
    expect(userFromData('ana@x.com', { name: ' Ana ' })).toEqual({
      email: 'ana@x.com',
      name: 'Ana',
      role: 'member',
      active: true,
      uid: null,
      permissions: {},
      deleting: false,
      doneLogId: null,
    });
  });

  it('conserva un administrador activo con su uid y sus permisos', () => {
    const data = { name: 'Admin', role: 'admin', active: true, uid: 'u1', permissions: { tablero: true } };
    expect(userFromData('admin@x.com', data)).toMatchObject({
      role: 'admin',
      active: true,
      uid: 'u1',
      permissions: { tablero: true },
    });
  });

  it.each([['root'], ['Admin'], ['admin '], [1], [null]])('role = %j es miembro', (role) => {
    expect(userFromData('a@x.com', { name: 'A', role }).role).toBe('member');
  });

  it.each([[false], ['no'], ['true'], [0], [1], [null]])('active = %j es inactivo', (active) => {
    expect(userFromData('a@x.com', { name: 'A', active }).active).toBe(false);
  });

  it.each([[''], [null], [42]])('uid = %j es "sin registrar"', (uid) => {
    expect(userFromData('a@x.com', { name: 'A', uid }).uid).toBeNull();
  });

  // Las reglas niegan todo el tablero de esa persona (fallan cerradas): la interfaz lo apaga igual (A-52).
  it.each([['todo'], [['tablero']], [null], [false]])(
    'permissions = %j que no es un mapa apaga el tablero',
    (permissions) => {
      expect(userFromData('a@x.com', { name: 'A', permissions }).permissions).toEqual({ board: false });
    },
  );

  it('sin permissions quedan los valores iniciales (mapa vacío)', () => {
    expect(userFromData('a@x.com', { name: 'A' }).permissions).toEqual({});
  });

  it('solo un mapa en deleting marca a la persona en eliminación', () => {
    expect(userFromData('a@x.com', { name: 'A', deleting: { at: 1, doneLogId: 'l1' } }).deleting).toBe(true);
    expect(userFromData('a@x.com', { name: 'A', deleting: true }).deleting).toBe(false);
  });

  it('conserva el ID de la entrada delete-done de la marca de eliminación', () => {
    expect(userFromData('a@x.com', { name: 'A', deleting: { at: 1, doneLogId: 'l1' } }).doneLogId).toBe('l1');
    expect(userFromData('a@x.com', { name: 'A', deleting: { at: 1, doneLogId: 7 } }).doneLogId).toBeNull();
    expect(userFromData('a@x.com', { name: 'A', deleting: 'l1' }).doneLogId).toBeNull();
  });

  it('un nombre que no es texto queda vacío', () => {
    expect(userFromData('a@x.com', { name: 7 }).name).toBe('');
  });
});

describe('marcador de eliminación', () => {
  it('la clave es el uid o, si la persona nunca entró, su correo', () => {
    expect(deletionKey(userFromData('a@x.com', { name: 'A', uid: 'u1' }))).toBe('u1');
    expect(deletionKey(userFromData('a@x.com', { name: 'A' }))).toBe('a@x.com');
  });

  it('markerFromData conserva el estado, las tareas y la hora del respaldo', () => {
    const data = { state: 'backup-ready', taskCount: 21, backupAt: 5, backupHash: 'h', confirmedAt: 'x' };
    expect(markerFromData('u1', data)).toEqual({ key: 'u1', state: 'backup-ready', taskCount: 21, backupAt: 5 });
    expect(markerFromData('u1', { ...data, state: 'deleting' })?.state).toBe('deleting');
  });

  it.each([
    [{ state: 'listo', taskCount: 1, backupAt: 5 }],
    [{ state: 'deleting', taskCount: -1, backupAt: 5 }],
    [{ state: 'deleting', taskCount: 1.5, backupAt: 5 }],
    [{ state: 'deleting', taskCount: '3', backupAt: 5 }],
    [{ state: 'deleting', taskCount: 3, backupAt: '5' }],
  ])('un marcador mal formado se ignora: %j', (data) => {
    expect(markerFromData('u1', data)).toBeNull();
  });
});
