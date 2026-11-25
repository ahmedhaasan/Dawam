import type { DawamDatabase } from './database.js';

export interface ImportBatchRecord {
  id: number;
  filename: string;
  sha256: string;
  format: string;
  deviceSerial: string | null;
  importedAt: string;
  importedBy: number;
  rowsTotal: number;
  rowsNew: number;
  rowsDuplicate: number;
  rowsQuarantined: number;
  rowsMalformed: number;
}

export interface StoredPunchInput {
  batchId: number;
  deviceSerial: string;
  deviceUserId: string;
  punchedAtLocal: string;
  deviceStatus?: string;
  verifyMode?: string;
  rawLine: string;
}

export interface QuarantinedPunchRecord {
  id: number;
  batchId: number;
  deviceUserId: string;
  punchedAtLocal: string;
  rawLine: string;
  resolvedEmployeeId: number | null;
  resolvedAt: string | null;
}

const mapBatch = (row: Record<string, unknown>): ImportBatchRecord => ({
  id: Number(row.id),
  filename: String(row.filename),
  sha256: String(row.sha256),
  format: String(row.format),
  deviceSerial: row.device_serial === null ? null : String(row.device_serial),
  importedAt: String(row.imported_at),
  importedBy: Number(row.imported_by),
  rowsTotal: Number(row.rows_total ?? 0),
  rowsNew: Number(row.rows_new ?? 0),
  rowsDuplicate: Number(row.rows_dup ?? 0),
  rowsQuarantined: Number(row.rows_quarantined ?? 0),
  rowsMalformed: Number(row.rows_malformed ?? 0),
});

export class ImportRepository {
  constructor(private readonly database: DawamDatabase) {}

  createBatch(input: {
    filename: string;
    sha256: string;
    format: string;
    deviceSerial?: string;
    importedAt: string;
    importedBy: number;
  }): number {
    const inserted = this.database.connection
      .prepare(
        `INSERT INTO import_batches(filename,sha256,format,device_serial,imported_at,imported_by,rows_total,rows_new,rows_dup,rows_quarantined,rows_malformed)
         VALUES(?,?,?,?,?,?,0,0,0,0,0)`,
      )
      .run(
        input.filename,
        input.sha256,
        input.format,
        input.deviceSerial ?? null,
        input.importedAt,
        input.importedBy,
      );
    return Number(inserted.lastInsertRowid);
  }

  addCoverage(batchId: number, fromLocal: string, toLocal: string, confirmed: boolean): void {
    this.database.connection
      .prepare(
        'INSERT INTO import_coverage(batch_id,from_local,to_local,confirmed) VALUES(?,?,?,?)',
      )
      .run(batchId, fromLocal, toLocal, confirmed ? 1 : 0);
  }

  private replaceableDayPunches(
    deviceUserId: string,
    localDate: string,
    keepTimes: readonly string[],
  ): { table: string; id: number }[] {
    const from = `${localDate} 00:00:00`;
    const to = `${localDate} 23:59:59`;
    const keep = new Set(keepTimes);
    const replaceable: { table: string; id: number }[] = [];
    for (const table of ['raw_punches', 'quarantined_punches']) {
      const rows = this.database.connection
        .prepare(
          `SELECT id, punched_at_local AS at FROM ${table} WHERE device_user_id=? AND punched_at_local BETWEEN ? AND ?`,
        )
        .all(deviceUserId, from, to) as { id: number; at: string }[];
      for (const row of rows) if (!keep.has(row.at)) replaceable.push({ table, id: row.id });
    }
    return replaceable;
  }

  /** Read-only: how many stored punches deleteDayPunches would remove. */
  countDayPunchesToReplace(
    deviceUserId: string,
    localDate: string,
    keepTimes: readonly string[],
  ): number {
    return this.replaceableDayPunches(deviceUserId, localDate, keepTimes).length;
  }

  /** Removes stored punches for one device ID and date that are absent from the newer file. */
  deleteDayPunches(deviceUserId: string, localDate: string, keepTimes: readonly string[]): number {
    const rows = this.replaceableDayPunches(deviceUserId, localDate, keepTimes);
    for (const row of rows) {
      this.database.connection.prepare(`DELETE FROM ${row.table} WHERE id=?`).run(row.id);
    }
    return rows.length;
  }

  insertPunch(input: StoredPunchInput): boolean {
    const inserted = this.database.connection
      .prepare(
        `INSERT OR IGNORE INTO raw_punches(batch_id,device_serial,device_user_id,punched_at_local,device_status,verify_mode,raw_line)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        input.batchId,
        input.deviceSerial,
        input.deviceUserId,
        input.punchedAtLocal,
        input.deviceStatus ?? null,
        input.verifyMode ?? null,
        input.rawLine,
      );
    return inserted.changes === 1;
  }

  hasPunch(deviceSerial: string, deviceUserId: string, punchedAtLocal: string): boolean {
    return Boolean(
      this.database.connection
        .prepare(
          'SELECT 1 FROM raw_punches WHERE device_serial=? AND device_user_id=? AND punched_at_local=?',
        )
        .get(deviceSerial, deviceUserId, punchedAtLocal),
    );
  }

  insertQuarantined(input: Omit<StoredPunchInput, 'deviceSerial'>): boolean {
    const inserted = this.database.connection
      .prepare(
        `INSERT OR IGNORE INTO quarantined_punches(batch_id,device_user_id,punched_at_local,raw_line)
         VALUES(?,?,?,?)`,
      )
      .run(input.batchId, input.deviceUserId, input.punchedAtLocal, input.rawLine);
    return inserted.changes === 1;
  }

  isDeviceIdIgnored(deviceUserId: string): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT 1 FROM ignored_device_ids WHERE device_user_id=?')
        .get(deviceUserId),
    );
  }

  ignoreDeviceId(deviceUserId: string, reason: string, ignoredBy: number, ignoredAt: string): void {
    this.database.connection
      .prepare(
        `INSERT INTO ignored_device_ids(device_user_id,reason,ignored_by,ignored_at)
         VALUES(?,?,?,?)
         ON CONFLICT(device_user_id) DO UPDATE SET reason=excluded.reason,ignored_by=excluded.ignored_by,ignored_at=excluded.ignored_at`,
      )
      .run(deviceUserId, reason, ignoredBy, ignoredAt);
    this.database.connection
      .prepare(
        `UPDATE quarantined_punches SET ignored_at=?
         WHERE device_user_id=? AND resolved_employee_id IS NULL`,
      )
      .run(ignoredAt, deviceUserId);
  }

  markIgnoredPunches(deviceUserId: string, ignoredAt: string): void {
    this.database.connection
      .prepare(
        `UPDATE quarantined_punches SET ignored_at=?
         WHERE device_user_id=? AND resolved_employee_id IS NULL`,
      )
      .run(ignoredAt, deviceUserId);
  }

  hasQuarantined(deviceUserId: string, punchedAtLocal: string): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT 1 FROM quarantined_punches WHERE device_user_id=? AND punched_at_local=?')
        .get(deviceUserId, punchedAtLocal),
    );
  }

  resolvedEmployeeForDeviceId(deviceUserId: string): number | null {
    const row = this.database.connection
      .prepare(
        `SELECT resolved_employee_id FROM quarantined_punches
         WHERE device_user_id=? AND resolved_employee_id IS NOT NULL
         ORDER BY resolved_at DESC LIMIT 1`,
      )
      .get(deviceUserId) as { resolved_employee_id?: number } | undefined;
    return row?.resolved_employee_id ? Number(row.resolved_employee_id) : null;
  }

  listUnresolvedQuarantined(): readonly QuarantinedPunchRecord[] {
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM quarantined_punches WHERE resolved_employee_id IS NULL AND ignored_at IS NULL
         ORDER BY punched_at_local,id`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      batchId: Number(row.batch_id),
      deviceUserId: String(row.device_user_id),
      punchedAtLocal: String(row.punched_at_local),
      rawLine: String(row.raw_line),
      resolvedEmployeeId: null,
      resolvedAt: null,
    }));
  }

  findQuarantined(id: number): QuarantinedPunchRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM quarantined_punches WHERE id=?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      batchId: Number(row.batch_id),
      deviceUserId: String(row.device_user_id),
      punchedAtLocal: String(row.punched_at_local),
      rawLine: String(row.raw_line),
      resolvedEmployeeId:
        row.resolved_employee_id === null ? null : Number(row.resolved_employee_id),
      resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    };
  }

  resolveQuarantined(id: number, employeeId: number, resolvedAt: string): void {
    this.database.connection
      .prepare(
        `UPDATE quarantined_punches SET resolved_employee_id=?,resolved_at=?
         WHERE id=? AND resolved_employee_id IS NULL`,
      )
      .run(employeeId, resolvedAt, id);
  }

  finishBatch(
    batchId: number,
    summary: {
      rowsTotal: number;
      rowsNew: number;
      rowsDuplicate: number;
      rowsQuarantined: number;
      rowsMalformed: number;
    },
  ): ImportBatchRecord {
    this.database.connection
      .prepare(
        `UPDATE import_batches SET rows_total=?,rows_new=?,rows_dup=?,rows_quarantined=?,rows_malformed=? WHERE id=?`,
      )
      .run(
        summary.rowsTotal,
        summary.rowsNew,
        summary.rowsDuplicate,
        summary.rowsQuarantined,
        summary.rowsMalformed,
        batchId,
      );
    return this.findBatch(batchId)!;
  }

  findBatch(id: number): ImportBatchRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM import_batches WHERE id=?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapBatch(row) : null;
  }

  listBatches(): readonly ImportBatchRecord[] {
    const rows = this.database.connection
      .prepare('SELECT * FROM import_batches ORDER BY id DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapBatch);
  }

  countRawPunches(): number {
    const row = this.database.connection
      .prepare('SELECT COUNT(*) AS count FROM raw_punches')
      .get() as {
      count: number;
    };
    return Number(row.count);
  }

  countQuarantined(): number {
    const row = this.database.connection
      .prepare(
        'SELECT COUNT(*) AS count FROM quarantined_punches WHERE resolved_employee_id IS NULL',
      )
      .get() as { count: number };
    return Number(row.count);
  }
}
