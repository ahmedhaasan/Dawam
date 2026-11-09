import {
  calculatePayroll,
  type PayrollInput,
  type PayrollOptions,
  type PayrollPolicy,
  type PayrollResult,
} from '@dawam/core';
import {
  AuditRepository,
  type Clock,
  type DawamDatabase,
  PayrollRepository,
  systemClock,
  WorkforceRepository,
} from '@dawam/db';

import type { AuthService } from './auth-service.js';
import type { AttendanceService } from './attendance-service.js';
import type { ServiceResult } from './service-result.js';

export interface PayrollPolicyConfig {
  policy: PayrollPolicy;
  options?: PayrollOptions;
}

export interface PayrollPolicyView {
  id: number;
  name: string;
  version: number;
  config: PayrollPolicyConfig;
  createdAt: string;
}

export interface PayrollPreviewView {
  employee: { id: number; fullName: string; deviceUserId: string };
  month: string;
  policy: PayrollPolicyView;
  input: PayrollInput;
  result: PayrollResult;
}

export interface PayrollRunView {
  id: number;
  employeeId: number;
  month: string;
  policyId: number;
  policySnapshot: unknown;
  inputsSnapshot: unknown;
  result: PayrollResult;
  status: 'approved' | 'void';
  approvedBy: number;
  approvedAt: string;
  voidReason: string | null;
}

export interface PayrollError {
  code: string;
  messageKey: string;
  details?: readonly string[];
}

const failure = (code: string, details?: readonly string[]): PayrollError => ({
  code,
  messageKey: `errors.payroll_${code.toLowerCase()}`,
  ...(details ? { details } : {}),
});

const policyView = (record: {
  id: number;
  name: string;
  version: number;
  config: unknown;
  createdAt: string;
}): PayrollPolicyView => ({
  id: record.id,
  name: record.name,
  version: record.version,
  config: record.config as PayrollPolicyConfig,
  createdAt: record.createdAt,
});

export class PayrollService {
  private readonly payroll: PayrollRepository;
  private readonly workforce: WorkforceRepository;
  private readonly audit: AuditRepository;

  constructor(
    private readonly database: DawamDatabase,
    private readonly auth: AuthService,
    private readonly attendance: AttendanceService,
    clock: Clock = systemClock,
  ) {
    this.payroll = new PayrollRepository(database, clock);
    this.workforce = new WorkforceRepository(database);
    this.audit = new AuditRepository(database, clock);
  }

  listPolicies(): ServiceResult<readonly PayrollPolicyView[], PayrollError> {
    const actor = this.auth.authorize('payroll.read');
    if (!actor.ok) return actor;
    return { ok: true, value: this.payroll.listPolicies().map(policyView) };
  }

  createPolicy(input: {
    name: string;
    config: PayrollPolicyConfig;
    reason: string;
  }): ServiceResult<PayrollPolicyView, PayrollError> {
    const actor = this.auth.authorize('payroll.read');
    if (!actor.ok) return actor;
    if (!input.name.trim()) return { ok: false, error: failure('INVALID_POLICY') };
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    const validation = calculatePayroll({
      monthlySalaryMinor: 0,
      wageBasisDays: 30,
      days: [],
      policy: input.config.policy,
      ...(input.config.options ? { options: input.config.options } : {}),
    });
    if (!validation.ok) {
      return {
        ok: false,
        error: failure(
          'INVALID_POLICY',
          validation.error.map((item) => item.code),
        ),
      };
    }
    let created!: ReturnType<PayrollRepository['insertPolicy']>;
    this.database.transaction(() => {
      created = this.payroll.insertPolicy({
        name: input.name.trim(),
        config: input.config,
        createdBy: actor.value.id,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'payroll.policy_created',
        entity: 'payroll_policy',
        entityId: String(created.id),
        after: created,
        reason: input.reason.trim(),
      });
    });
    return { ok: true, value: policyView(created) };
  }

  preview(
    employeeId: number,
    month: string,
    policyId: number,
    lateRoundingByDate: Readonly<Record<string, 'exact' | 'hour_up'>> = {},
  ): ServiceResult<PayrollPreviewView, PayrollError> {
    const actor = this.auth.authorize('payroll.read');
    if (!actor.ok) return actor;
    const employee = this.workforce.findEmployee(employeeId);
    if (!employee) return { ok: false, error: failure('EMPLOYEE_NOT_FOUND') };
    if (employee.monthlySalaryMinor === null)
      return { ok: false, error: failure('SALARY_REQUIRED') };
    const policyRecord = this.payroll.findPolicy(policyId);
    if (!policyRecord || !policyRecord.active)
      return { ok: false, error: failure('POLICY_NOT_FOUND') };
    const config = policyRecord.config as PayrollPolicyConfig;
    const attendance = this.attendance.month(employeeId, month);
    if (!attendance.ok) return { ok: false, error: failure('ATTENDANCE', [attendance.error.code]) };
    const payrollInput: PayrollInput = {
      monthlySalaryMinor: employee.monthlySalaryMinor,
      wageBasisDays: employee.wageBasisDays,
      days: attendance.value.days.map((day) => ({
        date: day.date,
        status: day.status,
        lateMinutes: day.lateMinutes ?? 0,
        lateRounding: lateRoundingByDate[day.date] ?? 'exact',
        ...(day.scheduledMinutes ? { scheduledMinutes: day.scheduledMinutes } : {}),
      })),
      policy: config.policy,
      ...(config.options ? { options: config.options } : {}),
    };
    const calculated = calculatePayroll(payrollInput);
    if (!calculated.ok)
      return {
        ok: false,
        error: failure(
          'CALCULATION',
          calculated.error.map((item) => item.code),
        ),
      };
    return {
      ok: true,
      value: {
        employee: {
          id: employee.id,
          fullName: employee.fullName,
          deviceUserId: employee.deviceUserId,
        },
        month,
        policy: policyView(policyRecord),
        input: payrollInput,
        result: calculated.value,
      },
    };
  }

  approve(input: {
    employeeId: number;
    month: string;
    policyId: number;
    lateRoundingByDate?: Readonly<Record<string, 'exact' | 'hour_up'>>;
    reason: string;
  }): ServiceResult<PayrollRunView, PayrollError> {
    const actor = this.auth.authorize('payroll.read');
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    if (
      this.payroll.listRuns(input.employeeId, input.month).some((run) => run.status === 'approved')
    )
      return { ok: false, error: failure('ALREADY_APPROVED') };
    const preview = this.preview(
      input.employeeId,
      input.month,
      input.policyId,
      input.lateRoundingByDate,
    );
    if (!preview.ok) return preview;
    let approved!: ReturnType<PayrollRepository['insertApprovedRun']>;
    this.database.transaction(() => {
      approved = this.payroll.insertApprovedRun({
        employeeId: input.employeeId,
        month: input.month,
        policyId: input.policyId,
        policySnapshot: preview.value.policy,
        inputsSnapshot: preview.value.input,
        result: preview.value.result,
        approvedBy: actor.value.id,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'payroll.approved',
        entity: 'payroll_run',
        entityId: String(approved.id),
        after: approved,
        reason: input.reason.trim(),
      });
    });
    return { ok: true, value: approved as PayrollRunView };
  }

  listRuns(
    employeeId: number,
    month: string,
  ): ServiceResult<readonly PayrollRunView[], PayrollError> {
    const actor = this.auth.authorize('payroll.read');
    if (!actor.ok) return actor;
    return {
      ok: true,
      value: this.payroll.listRuns(employeeId, month) as readonly PayrollRunView[],
    };
  }

  voidRun(runId: number, reason: string): ServiceResult<PayrollRunView, PayrollError> {
    const actor = this.auth.authorize('payroll.read');
    if (!actor.ok) return actor;
    if (!reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    const existing = this.payroll.findRun(runId);
    if (!existing || existing.status !== 'approved')
      return { ok: false, error: failure('RUN_NOT_FOUND') };
    let voided!: ReturnType<PayrollRepository['voidRun']>;
    this.database.transaction(() => {
      voided = this.payroll.voidRun(runId, reason.trim());
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'payroll.voided',
        entity: 'payroll_run',
        entityId: String(runId),
        before: existing,
        after: voided,
        reason: reason.trim(),
      });
    });
    return { ok: true, value: voided as PayrollRunView };
  }
}
