import type { Clock } from './audit.js';
import { systemClock } from './audit.js';
import type { DawamDatabase } from './database.js';

export interface CorrectionRecord {
  id: number;
  employeeId: number;
  shiftDate: string;
  field: 'in' | 'out';
  newTimeLocal: string | null;
  reason: string;
  createdBy: number;
  createdAt: string;
}

export interface StoredAttendancePunch {
  id: string;
  deviceUserId: string;
  punchedAtLocal: string;
  deviceStatus?: string;
  verifyMode?: string;
}

export interface StoredCoverageInterval {
  fromLocal: string;
  toLocal: string;
  confirmed: boolean;
}

export interface StoredPunchCorrection {
  employeeId: string;
  shiftDate: string;
  field: 'in' | 'out';
  newTimeLocal: string | null;
  reason: string;
}

export class AttendanceRepository {
  constructor(
    private readonly database: DawamDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  listPunchesForEmployee(
    employeeId: number,
    deviceUserId: string,
  ): readonly StoredAttendancePunch[] {
    const raw = this.database.connection
      .prepare(
        `SELECT id,device_user_id,punched_at_local,device_status,verify_mode
         FROM raw_punches WHERE device_user_id=? ORDER BY punched_at_local,id`,
      )
      .all(deviceUserId) as Array<Record<string, unknown>>;
    const resolved = this.database.connection
      .prepare(
        `SELECT id,punched_at_local FROM quarantined_punches
         WHERE resolved_employee_id=? ORDER BY punched_at_local,id`,
      )
      .all(employeeId) as Array<Record<string, unknown>>;
    return [
      ...raw.map((row) => ({
        id: `raw:${String(row.id)}`,
        deviceUserId: String(row.device_user_id),
        punchedAtLocal: String(row.punched_at_local),
        ...(row.device_status === null ? {} : { deviceStatus: String(row.device_status) }),
        ...(row.verify_mode === null ? {} : { verifyMode: String(row.verify_mode) }),
      })),
      ...resolved.map((row) => ({
        id: `resolved:${String(row.id)}`,
        deviceUserId,
        punchedAtLocal: String(row.punched_at_local),
      })),
    ];
  }

  listConfirmedCoverage(): readonly StoredCoverageInterval[] {
    const rows = this.database.connection
      .prepare(
        `SELECT from_local,to_local,confirmed FROM import_coverage
         WHERE confirmed=1 ORDER BY from_local`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      fromLocal: String(row.from_local),
      toLocal: String(row.to_local),
      confirmed: Number(row.confirmed) === 1,
    }));
  }

  listCorrections(employeeId: number, month: string): readonly StoredPunchCorrection[] {
    const rows = this.database.connection
      .prepare(
        `SELECT employee_id,shift_date,field,new_time_local,reason
         FROM punch_corrections
         WHERE employee_id=? AND shift_date LIKE ? AND voided_at IS NULL
         ORDER BY id`,
      )
      .all(employeeId, `${month}-%`) as Array<Record<string, unknown>>;
    const latest = new Map<string, StoredPunchCorrection>();
    for (const row of rows) {
      const correction: StoredPunchCorrection = {
        employeeId: String(row.employee_id),
        shiftDate: String(row.shift_date),
        field: String(row.field) as 'in' | 'out',
        newTimeLocal: row.new_time_local === null ? null : String(row.new_time_local),
        reason: String(row.reason),
      };
      latest.set(`${correction.shiftDate}:${correction.field}`, correction);
    }
    return [...latest.values()];
  }

  setCorrection(input: {
    employeeId: number;
    shiftDate: string;
    field: 'in' | 'out';
    newTimeLocal: string | null;
    reason: string;
    createdBy: number;
  }): CorrectionRecord {
    const now = this.clock.now().toISOString();
    this.database.connection
      .prepare(
        `UPDATE punch_corrections SET voided_at=?
         WHERE employee_id=? AND shift_date=? AND field=? AND voided_at IS NULL`,
      )
      .run(now, input.employeeId, input.shiftDate, input.field);
    const inserted = this.database.connection
      .prepare(
        `INSERT INTO punch_corrections(employee_id,shift_date,field,new_time_local,reason,created_by,created_at)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        input.employeeId,
        input.shiftDate,
        input.field,
        input.newTimeLocal,
        input.reason,
        input.createdBy,
        now,
      );
    return { id: Number(inserted.lastInsertRowid), ...input, createdAt: now };
  }
}
