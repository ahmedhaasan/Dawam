import type { Clock } from './audit.js';
import { systemClock } from './audit.js';
import type { DawamDatabase } from './database.js';

export interface PayrollPolicyRecord {
  id: number;
  name: string;
  config: unknown;
  version: number;
  createdBy: number;
  createdAt: string;
  active: boolean;
}

export interface PayrollRunRecord {
  id: number;
  employeeId: number;
  month: string;
  policyId: number;
  policySnapshot: unknown;
  inputsSnapshot: unknown;
  result: unknown;
  status: 'approved' | 'void';
  approvedBy: number;
  approvedAt: string;
  voidReason: string | null;
}

const policy = (row: Record<string, unknown>): PayrollPolicyRecord => ({
  id: Number(row.id),
  name: String(row.name),
  config: JSON.parse(String(row.config_json)),
  version: Number(row.version),
  createdBy: Number(row.created_by),
  createdAt: String(row.created_at),
  active: Number(row.active) === 1,
});

const run = (row: Record<string, unknown>): PayrollRunRecord => ({
  id: Number(row.id),
  employeeId: Number(row.employee_id),
  month: String(row.month),
  policyId: Number(row.policy_id),
  policySnapshot: JSON.parse(String(row.policy_snapshot_json)),
  inputsSnapshot: JSON.parse(String(row.inputs_snapshot_json)),
  result: JSON.parse(String(row.result_json)),
  status: String(row.status) as PayrollRunRecord['status'],
  approvedBy: Number(row.approved_by),
  approvedAt: String(row.approved_at),
  voidReason: row.void_reason === null ? null : String(row.void_reason),
});

export class PayrollRepository {
  constructor(
    private readonly database: DawamDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  listPolicies(): readonly PayrollPolicyRecord[] {
    const rows = this.database.connection
      .prepare('SELECT * FROM payroll_policies WHERE active=1 ORDER BY name,version DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map(policy);
  }

  findPolicy(id: number): PayrollPolicyRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM payroll_policies WHERE id=?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? policy(row) : null;
  }

  insertPolicy(input: { name: string; config: unknown; createdBy: number }): PayrollPolicyRecord {
    const previous = this.database.connection
      .prepare('SELECT MAX(version) AS version FROM payroll_policies WHERE name=?')
      .get(input.name) as { version: number | null };
    const inserted = this.database.connection
      .prepare(
        `INSERT INTO payroll_policies(name,config_json,version,created_by,created_at,active)
         VALUES(?,?,?,?,?,1)`,
      )
      .run(
        input.name,
        JSON.stringify(input.config),
        (previous.version ?? 0) + 1,
        input.createdBy,
        this.clock.now().toISOString(),
      );
    return this.findPolicy(Number(inserted.lastInsertRowid))!;
  }

  listRuns(employeeId: number, month: string): readonly PayrollRunRecord[] {
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM payroll_runs WHERE employee_id=? AND month=?
         ORDER BY approved_at DESC,id DESC`,
      )
      .all(employeeId, month) as Array<Record<string, unknown>>;
    return rows.map(run);
  }

  findRun(id: number): PayrollRunRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM payroll_runs WHERE id=?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? run(row) : null;
  }

  insertApprovedRun(input: {
    employeeId: number;
    month: string;
    policyId: number;
    policySnapshot: unknown;
    inputsSnapshot: unknown;
    result: unknown;
    approvedBy: number;
  }): PayrollRunRecord {
    const inserted = this.database.connection
      .prepare(
        `INSERT INTO payroll_runs(employee_id,month,policy_id,policy_snapshot_json,
          inputs_snapshot_json,result_json,status,approved_by,approved_at)
         VALUES(?,?,?,?,?,?,'approved',?,?)`,
      )
      .run(
        input.employeeId,
        input.month,
        input.policyId,
        JSON.stringify(input.policySnapshot),
        JSON.stringify(input.inputsSnapshot),
        JSON.stringify(input.result),
        input.approvedBy,
        this.clock.now().toISOString(),
      );
    return this.findRun(Number(inserted.lastInsertRowid))!;
  }

  voidRun(id: number, reason: string): PayrollRunRecord | null {
    this.database.connection
      .prepare(
        "UPDATE payroll_runs SET status='void',void_reason=? WHERE id=? AND status='approved'",
      )
      .run(reason, id);
    return this.findRun(id);
  }
}
