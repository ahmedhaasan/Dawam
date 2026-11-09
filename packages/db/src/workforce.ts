import type { DawamDatabase } from './database.js';

export interface EmployeeRecord {
  id: number;
  fullName: string;
  deviceUserId: string;
  photoPath: string | null;
  hireDate: string | null;
  active: boolean;
  monthlySalaryMinor: number | null;
  wageBasisDays: number;
}

export interface ShiftTemplateRecord {
  id: number;
  name: string;
  active: boolean;
  startMin: number;
  endMin: number;
  inFromMin: number;
  inToMin: number;
  outFromMin: number;
  outToMin: number;
}

export interface AssignmentRecord {
  id: number;
  employeeId: number;
  templateId: number;
  validFrom: string;
  validTo: string | null;
}

export interface WeeklyRestRecord {
  id: number;
  employeeId: number;
  weekday: number;
  validFrom: string;
  validTo: string | null;
}

export interface OverrideRecord {
  id: number;
  employeeId: number;
  date: string;
  kind: 'shift' | 'rest' | 'work_default' | 'cancel_coverage';
  templateId: number | null;
  reason: string;
  createdBy: number;
  createdAt: string;
}

export interface PairRecord {
  id: number;
  employeeA: number;
  employeeB: number;
  validFrom: string;
  validTo: string | null;
}

export interface LeaveRecord {
  id: number;
  employeeId: number;
  dateFrom: string;
  dateTo: string;
  kind: 'leave' | 'permission';
  note: string | null;
  approvedBy: number;
  createdAt: string;
}

const employee = (row: Record<string, unknown>): EmployeeRecord => ({
  id: Number(row.id),
  fullName: String(row.full_name),
  deviceUserId: String(row.device_user_id),
  photoPath: row.photo_path === null ? null : String(row.photo_path),
  hireDate: row.hire_date === null ? null : String(row.hire_date),
  active: Number(row.active) === 1,
  monthlySalaryMinor: row.monthly_salary_minor === null ? null : Number(row.monthly_salary_minor),
  wageBasisDays: Number(row.wage_basis_days),
});

const template = (row: Record<string, unknown>): ShiftTemplateRecord => ({
  id: Number(row.id),
  name: String(row.name),
  active: Number(row.active) === 1,
  startMin: Number(row.start_min),
  endMin: Number(row.end_min),
  inFromMin: Number(row.in_from_min),
  inToMin: Number(row.in_to_min),
  outFromMin: Number(row.out_from_min),
  outToMin: Number(row.out_to_min),
});

const assignment = (row: Record<string, unknown>): AssignmentRecord => ({
  id: Number(row.id),
  employeeId: Number(row.employee_id),
  templateId: Number(row.template_id),
  validFrom: String(row.valid_from),
  validTo: row.valid_to === null ? null : String(row.valid_to),
});
const rest = (row: Record<string, unknown>): WeeklyRestRecord => ({
  id: Number(row.id),
  employeeId: Number(row.employee_id),
  weekday: Number(row.weekday),
  validFrom: String(row.valid_from),
  validTo: row.valid_to === null ? null : String(row.valid_to),
});
const override = (row: Record<string, unknown>): OverrideRecord => ({
  id: Number(row.id),
  employeeId: Number(row.employee_id),
  date: String(row.date),
  kind: String(row.kind) as OverrideRecord['kind'],
  templateId: row.template_id === null ? null : Number(row.template_id),
  reason: String(row.reason),
  createdBy: Number(row.created_by),
  createdAt: String(row.created_at),
});
const pair = (row: Record<string, unknown>): PairRecord => ({
  id: Number(row.id),
  employeeA: Number(row.employee_a),
  employeeB: Number(row.employee_b),
  validFrom: String(row.valid_from),
  validTo: row.valid_to === null ? null : String(row.valid_to),
});
const leave = (row: Record<string, unknown>): LeaveRecord => ({
  id: Number(row.id),
  employeeId: Number(row.employee_id),
  dateFrom: String(row.date_from),
  dateTo: String(row.date_to),
  kind: String(row.kind) as LeaveRecord['kind'],
  note: row.note === null ? null : String(row.note),
  approvedBy: Number(row.approved_by),
  createdAt: String(row.created_at),
});

const all = <T>(
  database: DawamDatabase,
  sql: string,
  map: (row: Record<string, unknown>) => T,
): readonly T[] =>
  (database.connection.prepare(sql).all() as Array<Record<string, unknown>>).map(map);

export class WorkforceRepository {
  constructor(private readonly database: DawamDatabase) {}

  listEmployees(): readonly EmployeeRecord[] {
    return all(this.database, 'SELECT * FROM employees ORDER BY full_name', employee);
  }
  findEmployee(id: number): EmployeeRecord | null {
    const row = this.database.connection.prepare('SELECT * FROM employees WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    return row ? employee(row) : null;
  }
  findEmployeeByDeviceId(deviceUserId: string): EmployeeRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM employees WHERE device_user_id=?')
      .get(deviceUserId) as Record<string, unknown> | undefined;
    return row ? employee(row) : null;
  }
  insertEmployee(input: Omit<EmployeeRecord, 'id'>): EmployeeRecord {
    const result = this.database.connection
      .prepare(
        `INSERT INTO employees(full_name,device_user_id,photo_path,hire_date,active,monthly_salary_minor,wage_basis_days) VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        input.fullName,
        input.deviceUserId,
        input.photoPath,
        input.hireDate,
        input.active ? 1 : 0,
        input.monthlySalaryMinor,
        input.wageBasisDays,
      );
    return this.findEmployee(Number(result.lastInsertRowid))!;
  }
  updateEmployee(id: number, input: Omit<EmployeeRecord, 'id'>): EmployeeRecord {
    this.database.connection
      .prepare(
        `UPDATE employees SET full_name=?,device_user_id=?,photo_path=?,hire_date=?,active=?,monthly_salary_minor=?,wage_basis_days=? WHERE id=?`,
      )
      .run(
        input.fullName,
        input.deviceUserId,
        input.photoPath,
        input.hireDate,
        input.active ? 1 : 0,
        input.monthlySalaryMinor,
        input.wageBasisDays,
        id,
      );
    return this.findEmployee(id)!;
  }

  hasEmployeeHistory(id: number, deviceUserId: string): boolean {
    const checks: ReadonlyArray<{ sql: string; params: readonly (number | string)[] }> = [
      { sql: 'SELECT 1 FROM leaves WHERE employee_id=? LIMIT 1', params: [id] },
      {
        sql: 'SELECT 1 FROM quarantined_punches WHERE resolved_employee_id=? LIMIT 1',
        params: [id],
      },
      { sql: 'SELECT 1 FROM punch_corrections WHERE employee_id=? LIMIT 1', params: [id] },
      { sql: 'SELECT 1 FROM payroll_runs WHERE employee_id=? LIMIT 1', params: [id] },
      {
        sql: 'SELECT 1 FROM raw_punches WHERE device_user_id=? LIMIT 1',
        params: [deviceUserId],
      },
    ];
    return checks.some(({ sql, params }) =>
      Boolean(this.database.connection.prepare(sql).get(...params)),
    );
  }

  deleteEmployee(id: number): void {
    this.database.connection
      .prepare('DELETE FROM teammate_pairs WHERE employee_a=? OR employee_b=?')
      .run(id, id);
    this.database.connection.prepare('DELETE FROM schedule_overrides WHERE employee_id=?').run(id);
    this.database.connection.prepare('DELETE FROM weekly_rest WHERE employee_id=?').run(id);
    this.database.connection.prepare('DELETE FROM shift_assignments WHERE employee_id=?').run(id);
    this.database.connection.prepare('DELETE FROM employees WHERE id=?').run(id);
  }

  listTemplates(): readonly ShiftTemplateRecord[] {
    return all(this.database, 'SELECT * FROM shift_templates ORDER BY name', template);
  }
  findTemplate(id: number): ShiftTemplateRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM shift_templates WHERE id=?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? template(row) : null;
  }
  insertTemplate(input: Omit<ShiftTemplateRecord, 'id'>): ShiftTemplateRecord {
    const result = this.database.connection
      .prepare(
        `INSERT INTO shift_templates(name,active,start_min,end_min,in_from_min,in_to_min,out_from_min,out_to_min) VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.name,
        input.active ? 1 : 0,
        input.startMin,
        input.endMin,
        input.inFromMin,
        input.inToMin,
        input.outFromMin,
        input.outToMin,
      );
    return this.findTemplate(Number(result.lastInsertRowid))!;
  }
  updateTemplate(id: number, input: Omit<ShiftTemplateRecord, 'id'>): ShiftTemplateRecord {
    this.database.connection
      .prepare(
        `UPDATE shift_templates SET name=?,active=?,start_min=?,end_min=?,in_from_min=?,in_to_min=?,out_from_min=?,out_to_min=? WHERE id=?`,
      )
      .run(
        input.name,
        input.active ? 1 : 0,
        input.startMin,
        input.endMin,
        input.inFromMin,
        input.inToMin,
        input.outFromMin,
        input.outToMin,
        id,
      );
    return this.findTemplate(id)!;
  }
  isTemplateAssigned(id: number): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT 1 FROM shift_assignments WHERE template_id=? LIMIT 1')
        .get(id),
    );
  }

  listAssignments(): readonly AssignmentRecord[] {
    return all(this.database, 'SELECT * FROM shift_assignments ORDER BY valid_from', assignment);
  }
  insertAssignment(input: Omit<AssignmentRecord, 'id'>): AssignmentRecord {
    const result = this.database.connection
      .prepare(
        'INSERT INTO shift_assignments(employee_id,template_id,valid_from,valid_to) VALUES(?,?,?,?)',
      )
      .run(input.employeeId, input.templateId, input.validFrom, input.validTo);
    const row = this.database.connection
      .prepare('SELECT * FROM shift_assignments WHERE id=?')
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return assignment(row);
  }
  findAssignmentAt(employeeId: number, date: string): AssignmentRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT * FROM shift_assignments WHERE employee_id=? AND valid_from<=?
         AND COALESCE(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC LIMIT 1`,
      )
      .get(employeeId, date, date) as Record<string, unknown> | undefined;
    return row ? assignment(row) : null;
  }
  updateAssignment(
    id: number,
    input: Pick<AssignmentRecord, 'templateId' | 'validTo'>,
  ): AssignmentRecord {
    this.database.connection
      .prepare('UPDATE shift_assignments SET template_id=?,valid_to=? WHERE id=?')
      .run(input.templateId, input.validTo, id);
    const row = this.database.connection
      .prepare('SELECT * FROM shift_assignments WHERE id=?')
      .get(id) as Record<string, unknown>;
    return assignment(row);
  }
  hasAssignmentOverlap(employeeId: number, from: string, to: string | null): boolean {
    return Boolean(
      this.database.connection
        .prepare(
          `SELECT 1 FROM shift_assignments WHERE employee_id=? AND valid_from<=COALESCE(?, '9999-12-31') AND COALESCE(valid_to,'9999-12-31')>=? LIMIT 1`,
        )
        .get(employeeId, to, from),
    );
  }

  listRests(): readonly WeeklyRestRecord[] {
    return all(this.database, 'SELECT * FROM weekly_rest ORDER BY valid_from', rest);
  }
  insertRest(input: Omit<WeeklyRestRecord, 'id'>): WeeklyRestRecord {
    const result = this.database.connection
      .prepare('INSERT INTO weekly_rest(employee_id,weekday,valid_from,valid_to) VALUES(?,?,?,?)')
      .run(input.employeeId, input.weekday, input.validFrom, input.validTo);
    const row = this.database.connection
      .prepare('SELECT * FROM weekly_rest WHERE id=?')
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return rest(row);
  }
  findRestAt(employeeId: number, date: string): WeeklyRestRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT * FROM weekly_rest WHERE employee_id=? AND valid_from<=?
         AND COALESCE(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC LIMIT 1`,
      )
      .get(employeeId, date, date) as Record<string, unknown> | undefined;
    return row ? rest(row) : null;
  }
  updateRest(id: number, input: Pick<WeeklyRestRecord, 'weekday' | 'validTo'>): WeeklyRestRecord {
    this.database.connection
      .prepare('UPDATE weekly_rest SET weekday=?,valid_to=? WHERE id=?')
      .run(input.weekday, input.validTo, id);
    const row = this.database.connection
      .prepare('SELECT * FROM weekly_rest WHERE id=?')
      .get(id) as Record<string, unknown>;
    return rest(row);
  }
  hasRestOverlap(employeeId: number, from: string, to: string | null): boolean {
    return Boolean(
      this.database.connection
        .prepare(
          `SELECT 1 FROM weekly_rest WHERE employee_id=? AND valid_from<=COALESCE(?, '9999-12-31') AND COALESCE(valid_to,'9999-12-31')>=? LIMIT 1`,
        )
        .get(employeeId, to, from),
    );
  }

  listOverrides(): readonly OverrideRecord[] {
    return all(this.database, 'SELECT * FROM schedule_overrides ORDER BY date', override);
  }
  findOverride(employeeId: number, date: string): OverrideRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM schedule_overrides WHERE employee_id=? AND date=?')
      .get(employeeId, date) as Record<string, unknown> | undefined;
    return row ? override(row) : null;
  }
  upsertOverride(input: Omit<OverrideRecord, 'id'>): OverrideRecord {
    this.database.connection
      .prepare(
        `INSERT INTO schedule_overrides(employee_id,date,kind,template_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(employee_id,date) DO UPDATE SET kind=excluded.kind,template_id=excluded.template_id,reason=excluded.reason,created_by=excluded.created_by,created_at=excluded.created_at`,
      )
      .run(
        input.employeeId,
        input.date,
        input.kind,
        input.templateId,
        input.reason,
        input.createdBy,
        input.createdAt,
      );
    return this.findOverride(input.employeeId, input.date)!;
  }

  listPairs(): readonly PairRecord[] {
    return all(this.database, 'SELECT * FROM teammate_pairs ORDER BY valid_from', pair);
  }
  insertPair(input: Omit<PairRecord, 'id'>): PairRecord {
    const result = this.database.connection
      .prepare(
        'INSERT INTO teammate_pairs(employee_a,employee_b,valid_from,valid_to) VALUES(?,?,?,?)',
      )
      .run(input.employeeA, input.employeeB, input.validFrom, input.validTo);
    const row = this.database.connection
      .prepare('SELECT * FROM teammate_pairs WHERE id=?')
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return pair(row);
  }
  findPairAt(employeeId: number, date: string): PairRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT * FROM teammate_pairs WHERE (employee_a=? OR employee_b=?) AND valid_from<=?
         AND COALESCE(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC LIMIT 1`,
      )
      .get(employeeId, employeeId, date, date) as Record<string, unknown> | undefined;
    return row ? pair(row) : null;
  }
  updatePair(
    id: number,
    input: Pick<PairRecord, 'employeeA' | 'employeeB' | 'validTo'>,
  ): PairRecord {
    this.database.connection
      .prepare('UPDATE teammate_pairs SET employee_a=?,employee_b=?,valid_to=? WHERE id=?')
      .run(input.employeeA, input.employeeB, input.validTo, id);
    const row = this.database.connection
      .prepare('SELECT * FROM teammate_pairs WHERE id=?')
      .get(id) as Record<string, unknown>;
    return pair(row);
  }
  deletePair(id: number): void {
    this.database.connection.prepare('DELETE FROM teammate_pairs WHERE id=?').run(id);
  }
  hasPairOverlap(employeeIds: readonly [number, number], from: string, to: string | null): boolean {
    const [a, b] = employeeIds;
    return Boolean(
      this.database.connection
        .prepare(
          `SELECT 1 FROM teammate_pairs WHERE (employee_a IN (?,?) OR employee_b IN (?,?)) AND valid_from<=COALESCE(?, '9999-12-31') AND COALESCE(valid_to,'9999-12-31')>=? LIMIT 1`,
        )
        .get(a, b, a, b, to, from),
    );
  }

  listLeaves(): readonly LeaveRecord[] {
    return all(this.database, 'SELECT * FROM leaves ORDER BY date_from', leave);
  }
  insertLeave(input: Omit<LeaveRecord, 'id'>): LeaveRecord {
    const result = this.database.connection
      .prepare(
        'INSERT INTO leaves(employee_id,date_from,date_to,kind,note,approved_by,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        input.employeeId,
        input.dateFrom,
        input.dateTo,
        input.kind,
        input.note,
        input.approvedBy,
        input.createdAt,
      );
    const row = this.database.connection
      .prepare('SELECT * FROM leaves WHERE id=?')
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return leave(row);
  }
}
