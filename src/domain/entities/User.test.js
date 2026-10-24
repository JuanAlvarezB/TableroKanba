import { describe, expect, it } from 'vitest';
import { userFromData } from './User.js';

describe('userFromData', () => {
  it('un documento legado (solo name) es un miembro activo que nunca ha entrado', () => {
    expect(userFromData('ana@x.com', { name: ' Ana ' })).toEqual({
      email: 'ana@x.com',
      name: 'Ana',
      role: 'member',
      active: true,
      uid: null,
      permissions: {},
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

  it.each([['todo'], [['tablero']], [null]])('permissions = %j que no es un mapa queda vacío', (permissions) => {
    expect(userFromData('a@x.com', { name: 'A', permissions }).permissions).toEqual({});
  });

  it('un nombre que no es texto queda vacío', () => {
    expect(userFromData('a@x.com', { name: 7 }).name).toBe('');
  });
});
