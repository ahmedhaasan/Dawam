import { AuditRepository, DawamDatabase } from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AttendanceService } from '../src/main/services/attendance-service.js';
import { AuthService } from '../src/main/services/auth-service.js';
import { ImportService } from '../src/main/services/import-service.js';
import { PayrollService } from '../src/main/services/payroll-service.js';
import { WorkforceService } from '../src/main/services/workforce-service.js';

const databases: DawamDatabase[] = [];
const clock = { now: () => new Date('2026-12-02T10:00:00.000Z') };
const encoded = (value: string): string => Buffer.from(value).toString('base64');

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

const setup = async () => {
  const database = new DawamDatabase();
  databases.push(database);
  const auth = new AuthService(database, { clock });
  await auth.createFirstAdmin({ username: 'owner', password: 'SecurePass1', language: 'en' });
  const workforce = new WorkforceService(database, auth, '/tmp/dawam-payroll-test-photos', clock);
  const person = workforce.createEmployee({
    fullName: 'Synthetic Payroll Employee',
    deviceUserId: '001',
    active: true,
    monthlySalaryMinor: 600_000,
    wageBasisDays: 30,
    reason: 'Synthetic payroll test',
  });
  const templates = workforce.listTemplates();
  if (!person.ok || !templates.ok) throw new Error('Synthetic payroll setup failed');
  const morning = templates.value.find((template) => template.name === 'Morning')!;
  workforce.createAssignment({
    employeeId: person.value.id,
    templateId: morning.id,
    validFrom: '2026-11-01',
    validTo: '2026-11-30',
    reason: 'Synthetic payroll schedule',
  });
  new ImportService(database, auth).commit({
    filename: 'synthetic_payroll.dat',
    dataBase64: encoded(
      '001\t2026-11-01 10:30:00\t1\t0\t15\t0\n' + '001\t2026-11-01 22:00:00\t1\t1\t15\t0\n',
    ),
    coverageFrom: '2026-11-01 00:00:00',
    coverageTo: '2026-11-02 23:59:59',
    coverageConfirmed: true,
  });
  const attendance = new AttendanceService(database, auth, clock);
  return {
    database,
    auth,
    workforce,
    employee: person.value,
    payroll: new PayrollService(database, auth, attendance, clock),
  };
};

describe('payroll service', () => {
  it('calculates payroll v2 overtime, per-date overrides, exclusions, and salary override', async () => {
    const { payroll, employee } = await setup();
    const policy = payroll.createPolicy({
      name: 'Payroll v2 synthetic',
      config: {
        version: 2,
        lateRule: {
          method: 'hours',
          hourlyAmountMinor: 10_000,
          hourThresholdMinutes: 30,
          shortLatenessAmountMinor: 2_500,
          fullDayThresholdMinutes: 60,
          graceMinutes: 0,
          capPerDayMinor: 20_000,
        },
        overtimeRule: {
          method: 'fixed_per_hour',
          amountPerHourMinor: 6_000,
          minimumMinutes: 15,
          rounding: 'exact',
          hoursPerExtraDay: 12,
        },
        absenceMultiplier: { numerator: 1, denominator: 1 },
      },
      reason: 'Synthetic payroll v2 policy',
    });
    if (!policy.ok) throw new Error(policy.error.code);
    const preview = payroll.preview(
      employee.id,
      '2026-11',
      policy.value.id,
      {},
      {
        '2026-11-01': { lateMethod: 'minutes', reason: 'Use exact minutes' },
        '2026-11-02': { included: false },
      },
      650_000,
    );
    if (!preview.ok) throw new Error(preview.error.code);
    expect(preview.value.result).toMatchObject({
      monthlySalaryMinor: 650_000,
      totalLateMinutes: 30,
      latenessDeductionMinor: 5_000,
      absenceDeductionMinor: 0,
      finalSalaryMinor: 645_000,
    });
    expect(preview.value.result.dates[0]).toMatchObject({
      method: 'minutes',
      edited: true,
      reason: 'Use exact minutes',
      deductionMinor: 5_000,
    });
  });

  it('requires an explicit policy and produces per-date preview totals', async () => {
    const { payroll, employee } = await setup();
    expect(payroll.listPolicies()).toEqual({ ok: true, value: [] });
    const policy = payroll.createPolicy({
      name: 'Hourly proportional',
      config: {
        policy: { id: 'hourly_proportional' },
        options: {
          graceMinutes: 0,
          graceMode: 'threshold',
          hourlyBasis: { kind: 'scheduled_shift' },
        },
      },
      reason: 'Synthetic payroll policy',
    });
    if (!policy.ok) throw new Error(policy.error.code);
    const preview = payroll.preview(employee.id, '2026-11', policy.value.id, {
      '2026-11-01': 'exact',
      '2026-11-02': 'full_day',
    });
    if (!preview.ok) throw new Error(preview.error.code);
    expect(preview.value.result).toMatchObject({
      monthlySalaryMinor: 600_000,
      dailyWageMinor: 20_000,
      totalLateMinutes: 30,
      absenceDays: 1,
      absenceDeductionMinor: 20_000,
    });
    expect(preview.value.result.dates.find((day) => day.date === '2026-11-01')).toMatchObject({
      actualLateMinutes: 30,
      billableLateMinutes: 30,
      rule: 'hourly_proportional',
      amountMinor: 833,
    });
  });

  it('supports separate audited custom deduction and bonus decisions', async () => {
    const { payroll, employee } = await setup();
    const policy = payroll.createPolicy({
      name: 'Custom day decisions',
      config: {
        version: 2,
        lateRule: {
          method: 'none',
          hourlyAmountMinor: 10_000,
          hourThresholdMinutes: 30,
          shortLatenessAmountMinor: 2_500,
          fullDayThresholdMinutes: 60,
          graceMinutes: 0,
          capPerDayMinor: null,
        },
        overtimeRule: {
          method: 'none',
          amountPerHourMinor: 6_000,
          minimumMinutes: 15,
          rounding: 'exact',
          hoursPerExtraDay: 12,
        },
        absenceMultiplier: { numerator: 1, denominator: 1 },
      },
      reason: 'Synthetic custom decisions policy',
    });
    if (!policy.ok) throw new Error(policy.error.code);
    const preview = payroll.preview(
      employee.id,
      '2026-11',
      policy.value.id,
      {},
      {
        '2026-11-01': {
          lateMethod: 'custom_amount',
          lateCustomAmountMinor: 1_500,
          lateReason: 'Documented deduction',
          overtimeMethod: 'custom_amount',
          overtimeCustomAmountMinor: 2_250,
          overtimeReason: 'Documented bonus',
        },
      },
    );
    if (!preview.ok) throw new Error(preview.error.code);
    expect(preview.value.result.dates[0]).toMatchObject({
      deductionMinor: 1_500,
      bonusMinor: 2_250,
      method: 'custom_amount',
      overtimeMethod: 'custom_amount',
    });
  });

  it('keeps approved snapshots immutable, supports void/re-approve, and audits every action', async () => {
    const { payroll, employee, workforce, database } = await setup();
    const policy = payroll.createPolicy({
      name: 'Any lateness',
      config: { policy: { id: 'day_any_lateness' } },
      reason: 'Synthetic approval policy',
    });
    if (!policy.ok) throw new Error(policy.error.code);
    const approved = payroll.approve({
      employeeId: employee.id,
      month: '2026-11',
      policyId: policy.value.id,
      reason: 'Synthetic manager approval',
    });
    if (!approved.ok) throw new Error(approved.error.code);
    expect(
      payroll.approve({
        employeeId: employee.id,
        month: '2026-11',
        policyId: policy.value.id,
        reason: 'Duplicate approval',
      }),
    ).toMatchObject({ ok: false, error: { code: 'ALREADY_APPROVED' } });
    workforce.updateEmployee(employee.id, {
      fullName: employee.fullName,
      deviceUserId: employee.deviceUserId,
      active: true,
      monthlySalaryMinor: 900_000,
      wageBasisDays: 30,
      reason: 'Synthetic later salary change',
    });
    const history = payroll.listRuns(employee.id, '2026-11');
    expect(history.ok && history.value[0]?.result.monthlySalaryMinor).toBe(600_000);
    expect(() =>
      database.connection
        .prepare("UPDATE payroll_runs SET result_json='{}' WHERE id=?")
        .run(approved.value.id),
    ).toThrow('approved payroll snapshot is immutable');
    expect(payroll.voidRun(approved.value.id, 'Synthetic correction required')).toMatchObject({
      ok: true,
      value: { status: 'void', voidReason: 'Synthetic correction required' },
    });
    expect(
      payroll.approve({
        employeeId: employee.id,
        month: '2026-11',
        policyId: policy.value.id,
        reason: 'Synthetic re-approval',
      }),
    ).toMatchObject({ ok: true, value: { status: 'approved' } });
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
  });

  it('denies all payroll data to non-admin users', async () => {
    const { payroll, auth, employee } = await setup();
    await auth.createUser({
      username: 'viewer',
      password: 'ViewerPass1',
      role: 'user',
      canImport: false,
      reason: 'Synthetic payroll permission test',
    });
    auth.logout();
    await auth.login('viewer', 'ViewerPass1');
    expect(payroll.listPolicies()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(payroll.preview(employee.id, '2026-11', 1)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(payroll.listRuns(employee.id, '2026-11')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
