import { AuditRepository, DawamDatabase, ImportRepository } from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AttendanceService } from '../src/main/services/attendance-service.js';
import { AuthService } from '../src/main/services/auth-service.js';
import { ImportService } from '../src/main/services/import-service.js';
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
  const workforce = new WorkforceService(
    database,
    auth,
    '/tmp/dawam-attendance-test-photos',
    clock,
  );
  const person = workforce.createEmployee({
    fullName: 'Synthetic Attendance Employee',
    deviceUserId: '001',
    active: true,
    wageBasisDays: 30,
    reason: 'Synthetic attendance test',
  });
  const templates = workforce.listTemplates();
  if (!person.ok || !templates.ok) throw new Error('Synthetic attendance setup failed');
  const morning = templates.value.find((template) => template.name === 'Morning')!;
  workforce.createAssignment({
    employeeId: person.value.id,
    templateId: morning.id,
    validFrom: '2026-11-01',
    validTo: '2026-11-30',
    reason: 'Synthetic monthly schedule',
  });
  const imports = new ImportService(database, auth);
  imports.commit({
    filename: 'synthetic_attlog.dat',
    dataBase64: encoded(
      '001\t2026-11-01 09:55:00\t1\t0\t15\t0\n' +
        '001\t2026-11-01 22:05:00\t1\t1\t15\t0\n' +
        '001\t2026-11-02 10:20:00\t1\t0\t15\t0\n' +
        '001\t2026-11-02 22:00:00\t1\t1\t15\t0\n' +
        '001\t2026-11-03 09:58:00\t1\t0\t15\t0\n',
    ),
    coverageFrom: '2026-11-01 00:00:00',
    coverageTo: '2026-11-05 23:59:59',
    coverageConfirmed: true,
  });
  return {
    database,
    auth,
    workforce,
    imports,
    employeeId: person.value.id,
    attendance: new AttendanceService(database, auth, clock),
  };
};

describe('monthly attendance service', () => {
  it('calculates attendance while limiting absence to confirmed import coverage', async () => {
    const { attendance, employeeId } = await setup();
    const result = attendance.month(employeeId, '2026-11');
    if (!result.ok) throw new Error(result.error.code);
    const byDate = new Map(result.value.days.map((day) => [day.date, day]));
    expect(byDate.get('2026-11-01')).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
    expect(byDate.get('2026-11-02')).toMatchObject({ status: 'PRESENT', lateMinutes: 20 });
    expect(byDate.get('2026-11-03')).toMatchObject({ status: 'MISSING_OUT' });
    expect(byDate.get('2026-11-04')).toMatchObject({ status: 'ABSENT' });
    expect(byDate.get('2026-11-06')).toMatchObject({ status: 'PENDING_IMPORT' });
    expect(result.value.summary.totalLateMinutes).toBe(20);
  });

  it('applies audited corrections without changing immutable raw punches', async () => {
    const { attendance, database, employeeId } = await setup();
    const repository = new ImportRepository(database);
    const rawCount = repository.countRawPunches();
    expect(
      attendance.correct({
        employeeId,
        shiftDate: '2026-11-03',
        field: 'out',
        newTimeLocal: '2026-11-03 22:02:00',
        reason: 'Synthetic missing OUT correction',
      }),
    ).toEqual({ ok: true, value: true });
    const result = attendance.month(employeeId, '2026-11');
    expect(result.ok && result.value.days.find((day) => day.date === '2026-11-03')).toMatchObject({
      status: 'PRESENT',
      punchOut: '2026-11-03 22:02:00',
    });
    expect(repository.countRawPunches()).toBe(rawCount);
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
  });

  it('allows users to read attendance but keeps corrections administrator-only', async () => {
    const { attendance, auth, employeeId } = await setup();
    await auth.createUser({
      username: 'viewer',
      password: 'ViewerPass1',
      role: 'user',
      canImport: false,
      reason: 'Synthetic permission test',
    });
    auth.logout();
    await auth.login('viewer', 'ViewerPass1');
    expect(attendance.month(employeeId, '2026-11')).toMatchObject({ ok: true });
    expect(
      attendance.correct({
        employeeId,
        shiftDate: '2026-11-03',
        field: 'out',
        newTimeLocal: '2026-11-03 22:02:00',
        reason: 'Forbidden correction',
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('attributes an overnight OUT punch to the shift start date', async () => {
    const { attendance, workforce, imports } = await setup();
    const person = workforce.createEmployee({
      fullName: 'Synthetic Overnight Employee',
      deviceUserId: '002',
      active: true,
      wageBasisDays: 30,
      reason: 'Synthetic overnight test',
    });
    const templates = workforce.listTemplates();
    if (!person.ok || !templates.ok) throw new Error('Synthetic overnight setup failed');
    const evening = templates.value.find((template) => template.name === 'Evening')!;
    workforce.createAssignment({
      employeeId: person.value.id,
      templateId: evening.id,
      validFrom: '2026-11-01',
      validTo: '2026-11-30',
      reason: 'Synthetic overnight assignment',
    });
    imports.commit({
      filename: 'synthetic_overnight.dat',
      dataBase64: encoded(
        '002\t2026-11-01 12:50:00\t1\t0\t15\t0\n' + '002\t2026-11-02 01:10:00\t1\t1\t15\t0\n',
      ),
      coverageFrom: '2026-11-01 00:00:00',
      coverageTo: '2026-11-02 02:00:00',
      coverageConfirmed: true,
    });
    const result = attendance.month(person.value.id, '2026-11');
    expect(result.ok && result.value.days.find((day) => day.date === '2026-11-01')).toMatchObject({
      status: 'PRESENT',
      punchIn: '2026-11-01 12:50:00',
      punchOut: '2026-11-02 01:10:00',
    });
  });

  it('calculates a 1000-punch month in under one second', async () => {
    const { attendance, imports, employeeId } = await setup();
    const rows = Array.from({ length: 1000 }, (_, index) => {
      const day = 10 + Math.floor(index / 100);
      const minuteOfDay = (index % 100) * 10;
      const hour = Math.floor(minuteOfDay / 60);
      const minute = minuteOfDay % 60;
      return `001\t2026-11-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00\t1\t0\t15\t0`;
    }).join('\n');
    const imported = imports.commit({
      filename: 'synthetic_1000_punches.dat',
      dataBase64: encoded(rows),
      coverageFrom: '2026-11-10 00:00:00',
      coverageTo: '2026-11-20 23:59:59',
      coverageConfirmed: true,
    });
    expect(imported).toMatchObject({ ok: true, value: { rowsNew: 1000 } });
    const started = performance.now();
    expect(attendance.month(employeeId, '2026-11')).toMatchObject({ ok: true });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
