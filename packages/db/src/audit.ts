import { createHash } from 'node:crypto';

import type { DawamDatabase } from './database.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface AuditInput {
  actorUserId: number | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export interface AuditRow {
  id: number;
  ts: string;
  actorUserId: number | null;
  action: string;
  entity: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  reason: string | null;
  prevHash: string;
  hash: string;
}

interface HashPayload {
  ts: string;
  actorUserId: number | null;
  action: string;
  entity: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  reason: string | null;
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalValue(value));

const jsonOrNull = (value: unknown): string | null =>
  value === undefined ? null : canonicalJson(value);

export const auditHash = (previousHash: string, payload: HashPayload): string =>
  createHash('sha256').update(previousHash).update(canonicalJson(payload)).digest('hex');

const mapAuditRow = (row: Record<string, unknown>): AuditRow => ({
  id: Number(row.id),
  ts: String(row.ts),
  actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
  action: String(row.action),
  entity: String(row.entity),
  entityId: row.entity_id === null ? null : String(row.entity_id),
  beforeJson: row.before_json === null ? null : String(row.before_json),
  afterJson: row.after_json === null ? null : String(row.after_json),
  reason: row.reason === null ? null : String(row.reason),
  prevHash: String(row.prev_hash),
  hash: String(row.hash),
});

export interface AuditVerification {
  valid: boolean;
  brokenAtId?: number;
}

export const verifyAuditRows = (rows: readonly AuditRow[]): AuditVerification => {
  let previousHash = '';
  for (const row of rows) {
    const payload: HashPayload = {
      ts: row.ts,
      actorUserId: row.actorUserId,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      beforeJson: row.beforeJson,
      afterJson: row.afterJson,
      reason: row.reason,
    };
    if (row.prevHash !== previousHash || row.hash !== auditHash(previousHash, payload)) {
      return { valid: false, brokenAtId: row.id };
    }
    previousHash = row.hash;
  }
  return { valid: true };
};

export class AuditRepository {
  constructor(
    private readonly database: DawamDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  append(input: AuditInput): AuditRow {
    const previous = this.database.connection
      .prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')
      .get() as { hash?: string } | undefined;
    const prevHash = previous?.hash ?? '';
    const payload: HashPayload = {
      ts: this.clock.now().toISOString(),
      actorUserId: input.actorUserId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeJson: jsonOrNull(input.before),
      afterJson: jsonOrNull(input.after),
      reason: input.reason ?? null,
    };
    const hash = auditHash(prevHash, payload);
    const result = this.database.connection
      .prepare(
        `INSERT INTO audit_log(
          ts,actor_user_id,action,entity,entity_id,before_json,after_json,reason,prev_hash,hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        payload.ts,
        payload.actorUserId,
        payload.action,
        payload.entity,
        payload.entityId,
        payload.beforeJson,
        payload.afterJson,
        payload.reason,
        prevHash,
        hash,
      );
    return { id: Number(result.lastInsertRowid), ...payload, prevHash, hash };
  }

  list(): readonly AuditRow[] {
    const rows = this.database.connection
      .prepare('SELECT * FROM audit_log ORDER BY id')
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapAuditRow);
  }

  verify(): AuditVerification {
    return verifyAuditRows(this.list());
  }

  reset(input: { actorUserId: number | null; reason: string }): {
    deletedCount: number;
    marker: AuditRow;
  } {
    return this.database.transaction(() => {
      const row = this.database.connection
        .prepare('SELECT COUNT(*) AS count FROM audit_log')
        .get() as { count: number };
      const deletedCount = Number(row.count);
      this.database.connection.exec('DROP TRIGGER audit_log_no_delete');
      try {
        this.database.connection.exec('DELETE FROM audit_log');
      } finally {
        this.database.connection.exec(`CREATE TRIGGER audit_log_no_delete
          BEFORE DELETE ON audit_log
          BEGIN
            SELECT RAISE(ABORT, 'audit_log is append-only');
          END;`);
      }
      const marker = this.append({
        actorUserId: input.actorUserId,
        action: 'audit.history_reset',
        entity: 'audit_log',
        after: { deletedCount },
        reason: input.reason,
      });
      return { deletedCount, marker };
    });
  }
}
