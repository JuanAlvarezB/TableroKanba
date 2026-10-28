import { describe, expect, it } from 'vitest';
import { buildLogEntry } from './AdminLog.js';

describe('buildLogEntry', () => {
  it('guarda la acción y los uids, con el detalle si lo hay', () => {
    expect(buildLogEntry('promote', 'u-admin', 'u-ana', { from: 'member', to: 'admin' })).toEqual({
      action: 'promote',
      actorUid: 'u-admin',
      targetUid: 'u-ana',
      detail: { from: 'member', to: 'admin' },
    });
  });

  it('sin uid de la persona (nunca ha entrado) queda null y sin detalle no envía el campo', () => {
    expect(buildLogEntry('deactivate', 'u-admin', null)).toEqual({
      action: 'deactivate',
      actorUid: 'u-admin',
      targetUid: null,
    });
  });
});
