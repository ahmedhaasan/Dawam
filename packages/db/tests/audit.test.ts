import { describe, expect, it } from 'vitest';

import { AuditRepository, type Clock, DawamDatabase, verifyAuditRows } from '../src/index.js';

const fixedClock: Clock = { now: () => new Date('2026-11-09T00:00:00.000Z') };

describe('tamper-evident audit log', () => {
  it('chains canonical records and verifies an intact chain', () => {
    const database = new DawamDatabase();
    const audit = new AuditRepository(database, fixedClock);
    const first = audit.append({
      actorUserId: null,
      action: 'test.created',
      entity: 'test',
      entityId: '1',
      after: { z: 1, a: 2 },
      reason: 'synthetic',
    });
    const second = audit.append({
      actorUserId: null,
      action: 'test.updated',
      entity: 'test',
      entityId: '1',
      before: { a: 2, z: 1 },
      after: { a: 3, z: 1 },
      reason: 'synthetic update',
    });
    expect(first.prevHash).toBe('');
    expect(second.prevHash).toBe(first.hash);
    expect(audit.verify()).toEqual({ valid: true });
    database.close();
  });

  it('detects a modified record and protects stored rows from update/delete', () => {
    const database = new DawamDatabase();
    const audit = new AuditRepository(database, fixedClock);
    audit.append({
      actorUserId: null,
      action: 'test.created',
      entity: 'test',
      after: { value: 1 },
    });
    const tampered = audit.list().map((row) => ({ ...row, action: 'tampered' }));
    expect(verifyAuditRows(tampered)).toEqual({ valid: false, brokenAtId: 1 });
    expect(() =>
      database.connection.exec("UPDATE audit_log SET action='tampered' WHERE id=1"),
    ).toThrow(/append-only/);
    expect(() => database.connection.exec('DELETE FROM audit_log WHERE id=1')).toThrow(
      /append-only/,
    );
    database.close();
  });
});
