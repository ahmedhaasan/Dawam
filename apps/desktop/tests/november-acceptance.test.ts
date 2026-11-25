import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DawamDatabase } from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AttendanceService } from '../src/main/services/attendance-service.js';
import { AuthService } from '../src/main/services/auth-service.js';
import { ImportService } from '../src/main/services/import-service.js';
import { WorkforceService } from '../src/main/services/workforce-service.js';

const fixtures = resolve(__dirname, '../../../tests/fixtures/synthetic');
const clock = { now: () => new Date('2026-12-05T10:00:00.000Z') };
const databases: DawamDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

interface ExpectedRow {
  date: string;
  employeeId: string;
  firstIn: string;
  lastOut: string;
  late: number;
  early: number;
  overtime: number;
  status: string;
}

const expectedRows = (): ExpectedRow[] =>
  readFileSync(resolve(fixtures, 'expected_results_november_2026.csv'), 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(',');
      return {
        date: cells[0]!,
        employeeId: cells[1]!,
        firstIn: cells[3]!,
        lastOut: cells[4]!,
        late: Number(cells[5] || 0),
        early: Number(cells[6] || 0),
        overtime: Number(cells[7] || 0),
        status: cells[8]!.split(' ')[0]!,
      };
    });

export const setupNovember = async () => {
  const database = new DawamDatabase();
  databases.push(database);
  const auth = new AuthService(database, { clock });
  await auth.createFirstAdmin({ username: 'owner', password: 'SecurePass1', language: 'en' });
  const workforce = new WorkforceService(database, auth, '/tmp/dawam-november-photos', clock);
  const templates = workforce.listTemplates();
  if (!templates.ok) throw new Error('templates');
  for (const template of templates.value) {
    const updated = workforce.updateTemplate(template.id, {
      name: template.name,
      active: true,
      startMin: template.startMin,
      endMin: template.endMin,
      inFromMin: template.inFromMin,
      inToMin: template.startMin + 120,
      outFromMin: template.outFromMin,
      outToMin: null,
      lateGraceMin: 20,
      checkoutOpenBeforeEndMin: 10,
      otCapMin: 480,
      reason: 'November acceptance setup',
    });
    if (!updated.ok) throw new Error(`template ${JSON.stringify(updated.error)}`);
  }
  const fresh = workforce.listTemplates();
  if (!fresh.ok) throw new Error('templates');
  const morning = fresh.value.find((item) => item.name === 'Morning')!;
  const evening = fresh.value.find((item) => item.name === 'Evening')!;

  const plan: Record<string, { template: typeof morning; rest: number }> = {
    '2': { template: morning, rest: 4 },
    '3': { template: evening, rest: 7 },
    '4': { template: evening, rest: 3 },
    '5': { template: morning, rest: 1 },
    '6': { template: morning, rest: 5 },
  };
  const ids: Record<string, number> = {};
  for (const [deviceId, item] of Object.entries(plan)) {
    const created = workforce.createEmployee({
      fullName: `Synthetic ${deviceId}`,
      deviceUserId: deviceId,
      hireDate: '2026-01-01',
      active: true,
      monthlySalaryMinor: 1_000_000,
      wageBasisDays: 30,
      reason: 'November acceptance setup',
    });
    if (!created.ok) throw new Error(`employee ${deviceId}`);
    ids[deviceId] = created.value.id;
    const assignment = workforce.createAssignment({
      employeeId: created.value.id,
      templateId: item.template.id,
      validFrom: '2026-11-01',
      validTo: '2026-11-30',
      reason: 'November acceptance setup',
    });
    if (!assignment.ok) throw new Error(`assignment ${deviceId}`);
    const rest = workforce.createRest({
      employeeId: created.value.id,
      weekday: item.rest,
      validFrom: '2026-11-01',
      validTo: '2026-11-30',
      reason: 'November acceptance setup',
    });
    if (!rest.ok) throw new Error(`rest ${deviceId}`);
  }
  for (const [a, b] of [
    ['2', '3'],
    ['4', '5'],
  ] as const) {
    const pair = workforce.createPair({
      employeeA: ids[a]!,
      employeeB: ids[b]!,
      validFrom: '2026-11-01',
      validTo: '2026-11-30',
      reason: 'November acceptance setup',
    });
    if (!pair.ok) throw new Error(`pair ${a}-${b}`);
  }

  const imports = new ImportService(database, auth, clock);
  const file = readFileSync(resolve(fixtures, 'attlog_november_2026_test.dat'));
  const committed = imports.commit({
    filename: 'attlog_november_2026_test.dat',
    dataBase64: file.toString('base64'),
    coverageFrom: '2026-11-01 00:00:00',
    coverageTo: '2026-12-01 23:59:59',
    coverageConfirmed: true,
  });
  if (!committed.ok) throw new Error('import');
  return {
    database,
    auth,
    workforce,
    imports,
    ids,
    attendance: new AttendanceService(database, auth, clock),
  };
};

describe('November 2026 acceptance (device IDs 2-6)', () => {
  it('matches expected_results_november_2026.csv for every employee and day', async () => {
    const { attendance, ids } = await setupNovember();
    const mismatches: string[] = [];
    const months = new Map<string, Map<string, ReturnType<typeof dayOf>>>();
    const dayOf = (view: { days: readonly { date: string }[] }, date: string) =>
      view.days.find((day) => day.date === date) as
        | {
            status: string;
            punchIn?: string;
            punchOut?: string;
            lateMinutes: number | null;
            earlyLeaveMinutes: number | null;
            overtimeMinutes: number | null;
          }
        | undefined;
    for (const [deviceId, employeeId] of Object.entries(ids)) {
      const month = attendance.month(employeeId, '2026-11');
      if (!month.ok) throw new Error(month.error.code);
      months.set(deviceId, new Map());
      for (const expected of expectedRows().filter((row) => row.employeeId === deviceId)) {
        const day = dayOf(month.value, expected.date);
        const tag = `${expected.date} #${deviceId}`;
        if (!day) {
          mismatches.push(`${tag}: missing day`);
          continue;
        }
        if (day.status !== expected.status) {
          mismatches.push(`${tag}: status ${day.status} != ${expected.status}`);
          continue;
        }
        if (expected.status === 'REST' || expected.status === 'ABSENT') continue;
        const inTime = day.punchIn?.slice(11, 19) ?? '';
        if (
          expected.status !== 'MISSING_IN' &&
          expected.status !== 'REVIEW' &&
          inTime !== expected.firstIn
        )
          mismatches.push(`${tag}: in ${inTime} != ${expected.firstIn}`);
        if (
          expected.status !== 'MISSING_OUT' &&
          expected.status !== 'REVIEW' &&
          (day.punchOut ?? '').slice(0, 19) !== expected.lastOut &&
          expected.lastOut
        )
          mismatches.push(`${tag}: out ${day.punchOut} != ${expected.lastOut}`);
        if (expected.status === 'PRESENT' || expected.status === 'EARLY_LEAVE') {
          if ((day.lateMinutes ?? 0) !== expected.late)
            mismatches.push(`${tag}: late ${day.lateMinutes} != ${expected.late}`);
          if ((day.earlyLeaveMinutes ?? 0) !== expected.early)
            mismatches.push(`${tag}: early ${day.earlyLeaveMinutes} != ${expected.early}`);
          if ((day.overtimeMinutes ?? 0) !== expected.overtime)
            mismatches.push(`${tag}: overtime ${day.overtimeMinutes} != ${expected.overtime}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('shows the 26 Nov check-in and check-out for employee 3 (regression)', async () => {
    const { attendance, ids } = await setupNovember();
    const month = attendance.month(ids['3']!, '2026-11');
    if (!month.ok) throw new Error(month.error.code);
    const day = month.value.days.find((item) => item.date === '2026-11-26')!;
    expect(day.punchIn).toBe('2026-11-26 09:43:30');
    expect(day.punchOut).toBe('2026-11-26 23:25:00');
    expect(day.status).toBe('EARLY_LEAVE');
  });

  it('replaces stored punches for the same device ID and date on re-import', async () => {
    const { imports, attendance, ids } = await setupNovember();
    const before = attendance.month(ids['2']!, '2026-11');
    if (!before.ok) throw new Error('month');
    const line = '2\t2026-11-09 09:50:00\t1\t0\t0\t0\n';
    const committed = imports.commit({
      filename: 'correction.dat',
      dataBase64: Buffer.from(line).toString('base64'),
      coverageFrom: '2026-11-09 00:00:00',
      coverageTo: '2026-11-09 23:59:59',
      coverageConfirmed: true,
    });
    expect(committed.ok).toBe(true);
    const after = attendance.month(ids['2']!, '2026-11');
    if (!after.ok) throw new Error('month');
    const day = after.value.days.find((item) => item.date === '2026-11-09')!;
    expect(day.punchIn).toBe('2026-11-09 09:50:00');
    expect(day.punchOut).toBeUndefined();
    const untouched = after.value.days.find((item) => item.date === '2026-11-10')!;
    const original = before.value.days.find((item) => item.date === '2026-11-10')!;
    expect(untouched.punchIn).toBe(original.punchIn);
  });
});
