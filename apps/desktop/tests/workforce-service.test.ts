import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditRepository, DawamDatabase } from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthService } from '../src/main/services/auth-service.js';
import { WorkforceService } from '../src/main/services/workforce-service.js';

const databases: DawamDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  while (databases.length) databases.pop()!.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

const setup = async () => {
  const database = new DawamDatabase();
  databases.push(database);
  const auth = new AuthService(database);
  await auth.createFirstAdmin({ username: 'owner', password: 'SecurePass1', language: 'en' });
  const directory = mkdtempSync(join(tmpdir(), 'dawam-photos-'));
  directories.push(directory);
  return { database, auth, service: new WorkforceService(database, auth, directory) };
};

const employee = (fullName: string, deviceUserId: string) => ({
  fullName,
  deviceUserId,
  active: true,
  monthlySalaryMinor: 600_000,
  wageBasisDays: 30,
  reason: 'Synthetic workforce test',
});

describe('workforce service', () => {
  it('enforces unique device IDs, stores valid photos, audits changes, and hides salary from users', async () => {
    const { database, auth, service } = await setup();
    const created = service.createEmployee({
      ...employee('Amina Hassan', '0007'),
      photo: {
        mimeType: 'image/png',
        dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
          'base64',
        ),
      },
    });
    expect(created).toMatchObject({
      ok: true,
      value: { deviceUserId: '0007', monthlySalaryMinor: 600_000 },
    });
    if (!created.ok) throw new Error('Synthetic employee was not created');
    expect(service.getEmployeePhoto(created.value.id)).toMatchObject({
      ok: true,
      value: { mimeType: 'image/png', dataBase64: expect.any(String) },
    });
    expect(service.createEmployee(employee('Duplicate', '0007'))).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_DEVICE_USER_ID' },
    });
    expect(
      service.createEmployee({
        ...employee('Bad photo', '9'),
        photo: {
          mimeType: 'image/png',
          dataBase64: Buffer.from('not an image').toString('base64'),
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PHOTO' } });

    await auth.createUser({
      username: 'viewer',
      password: 'ViewerPass1',
      role: 'user',
      canImport: false,
      reason: 'Synthetic workforce test',
    });
    auth.logout();
    await auth.login('viewer', 'ViewerPass1');
    const listed = service.listEmployees();
    expect(listed.ok && listed.value[0]).not.toHaveProperty('monthlySalaryMinor');
    expect(service.getEmployeePhoto(created.value.id)).toMatchObject({
      ok: true,
      value: { mimeType: 'image/png' },
    });
    expect(service.createEmployee(employee('Forbidden', '10'))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
  });

  it('permanently deletes only inactive employees without schedules, punches, or payroll history', async () => {
    const { database, service } = await setup();
    const unused = service.createEmployee(employee('Created by mistake', 'unused-1'));
    expect(unused.ok).toBe(true);
    if (!unused.ok) return;
    expect(service.deleteEmployee(unused.value.id, 'Remove mistaken employee')).toMatchObject({
      ok: false,
      error: { code: 'EMPLOYEE_MUST_BE_INACTIVE' },
    });
    expect(
      service.updateEmployee(unused.value.id, {
        ...employee('Created by mistake', 'unused-1'),
        active: false,
      }),
    ).toMatchObject({ ok: true, value: { active: false } });
    expect(service.deleteEmployee(unused.value.id, 'Remove mistaken employee')).toEqual({
      ok: true,
      value: true,
    });
    expect(service.listEmployees()).toMatchObject({ ok: true, value: [] });

    const scheduled = service.createEmployee(employee('Scheduled employee', 'scheduled-1'));
    const templates = service.listTemplates();
    expect(scheduled.ok && templates.ok).toBe(true);
    if (!scheduled.ok || !templates.ok) return;
    expect(
      service.createAssignment({
        employeeId: scheduled.value.id,
        templateId: templates.value[0]!.id,
        validFrom: '2026-11-01',
        validTo: null,
        reason: 'Schedule creates protected history',
      }),
    ).toMatchObject({ ok: true });
    service.updateEmployee(scheduled.value.id, {
      ...employee('Scheduled employee', 'scheduled-1'),
      active: false,
    });
    expect(service.deleteEmployee(scheduled.value.id, 'Remove unused scheduled record')).toEqual({
      ok: true,
      value: true,
    });

    const historical = service.createEmployee(employee('Employee with leave', 'history-1'));
    expect(historical.ok).toBe(true);
    if (!historical.ok) return;
    expect(
      service.createLeave({
        employeeId: historical.value.id,
        dateFrom: '2026-11-02',
        dateTo: '2026-11-02',
        kind: 'leave',
        note: 'Protected operational history',
        reason: 'Approved leave',
      }),
    ).toMatchObject({ ok: true });
    service.updateEmployee(historical.value.id, {
      ...employee('Employee with leave', 'history-1'),
      active: false,
    });
    expect(service.deleteEmployee(historical.value.id, 'Try to remove history')).toMatchObject({
      ok: false,
      error: { code: 'EMPLOYEE_HAS_HISTORY' },
    });
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
  });

  it('rejects invalid templates and changes assignments without rewriting history', async () => {
    const { service } = await setup();
    const person = service.createEmployee(employee('Karim Adel', '11'));
    const templates = service.listTemplates();
    expect(person.ok && templates.ok).toBe(true);
    const employeeId = person.ok ? person.value.id : 0;
    const templateId = templates.ok
      ? (templates.value.find((item) => item.name === 'Morning')?.id ?? 0)
      : 0;
    const eveningId = templates.ok
      ? (templates.value.find((item) => item.name === 'Evening')?.id ?? 0)
      : 0;
    expect(
      service.updateTemplate(templateId, {
        name: 'Updated Morning',
        active: true,
        startMin: 600,
        endMin: 1320,
        inFromMin: 580,
        inToMin: 660,
        outFromMin: 1300,
        outToMin: 1380,
        reason: 'Safe pre-assignment edit',
      }),
    ).toMatchObject({ ok: true, value: { name: 'Updated Morning' } });
    expect(
      service.createTemplate({
        name: 'Broken',
        active: true,
        startMin: 600,
        endMin: 900,
        inFromMin: 580,
        inToMin: 800,
        outFromMin: 700,
        outToMin: 920,
        reason: 'Synthetic validation',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_TEMPLATE' } });
    expect(
      service.createAssignment({
        employeeId,
        templateId,
        validFrom: '2026-11-01',
        validTo: '2026-11-15',
        reason: 'Initial assignment',
      }),
    ).toMatchObject({ ok: true });
    expect(
      service.updateTemplate(templateId, {
        name: 'Unsafe historical edit',
        active: true,
        startMin: 610,
        endMin: 1330,
        inFromMin: 590,
        inToMin: 670,
        outFromMin: 1310,
        outToMin: 1390,
        reason: 'Must be rejected',
      }),
    ).toMatchObject({ ok: false, error: { code: 'TEMPLATE_IN_USE' } });
    expect(
      service.createAssignment({
        employeeId,
        templateId: eveningId,
        validFrom: '2026-11-10',
        validTo: '2026-11-20',
        reason: 'Shift changed from this date',
      }),
    ).toMatchObject({ ok: true });
    const calendar = service.calendar(employeeId, '2026-11');
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-09')).toMatchObject({
      templateName: 'Updated Morning',
    });
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-10')).toMatchObject({
      templateName: 'Evening',
    });
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-21')).toMatchObject({
      kind: 'NO_SCHEDULE',
    });
  });

  it('loads and updates an employee schedule profile while preserving earlier dates', async () => {
    const { service } = await setup();
    const person = service.createEmployee(employee('Schedule Owner', 'S1'));
    const partner = service.createEmployee(employee('Coverage Partner', 'S2'));
    const templates = service.listTemplates();
    if (!person.ok || !partner.ok || !templates.ok) throw new Error('Synthetic setup failed');
    const morningId = templates.value[0]!.id;
    const eveningId = templates.value[1]!.id;

    expect(
      service.updateEmployeeSchedule({
        employeeId: person.value.id,
        templateId: morningId,
        weekday: 6,
        partnerId: partner.value.id,
        effectiveFrom: '2026-11-01',
        reason: 'Initial schedule profile',
      }),
    ).toMatchObject({
      ok: true,
      value: { templateId: morningId, weekday: 6, partnerId: partner.value.id },
    });
    expect(
      service.updateEmployeeSchedule({
        employeeId: person.value.id,
        templateId: eveningId,
        weekday: 5,
        partnerId: null,
        effectiveFrom: '2026-11-15',
        reason: 'Future schedule change',
      }),
    ).toMatchObject({
      ok: true,
      value: { templateId: eveningId, weekday: 5, partnerId: null },
    });
    expect(service.getEmployeeSchedule(person.value.id, '2026-11-14')).toMatchObject({
      ok: true,
      value: { templateId: morningId, weekday: 6, partnerId: partner.value.id },
    });
    expect(service.getEmployeeSchedule(person.value.id, '2026-11-15')).toMatchObject({
      ok: true,
      value: { templateId: eveningId, weekday: 5, partnerId: null },
    });
  });

  it('resolves coverage, both-off flags, cancellation overrides, and preserves past assignments', async () => {
    const { service } = await setup();
    const a = service.createEmployee(employee('Employee A', 'A'));
    const b = service.createEmployee(employee('Employee B', 'B'));
    const templates = service.listTemplates();
    if (!a.ok || !b.ok || !templates.ok) throw new Error('synthetic setup failed');
    const morning = templates.value.find((item) => item.name === 'Morning')!;
    const evening = templates.value.find((item) => item.name === 'Evening')!;

    for (const [employeeId, templateId] of [
      [a.value.id, morning.id],
      [b.value.id, evening.id],
    ] as const) {
      expect(
        service.createAssignment({
          employeeId,
          templateId,
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          reason: 'Base schedule',
        }),
      ).toMatchObject({ ok: true });
    }
    expect(
      service.createAssignment({
        employeeId: b.value.id,
        templateId: morning.id,
        validFrom: '2026-11-16',
        reason: 'Future schedule only',
      }),
    ).toMatchObject({ ok: true });
    expect(
      service.createRest({
        employeeId: a.value.id,
        weekday: 6,
        validFrom: '2026-11-01',
        reason: 'Saturday rest',
      }),
    ).toMatchObject({ ok: true });
    expect(
      service.createPair({
        employeeA: a.value.id,
        employeeB: b.value.id,
        validFrom: '2026-11-01',
        validTo: '2026-11-15',
        reason: 'Coverage pair',
      }),
    ).toMatchObject({ ok: true });

    let calendar = service.calendar(b.value.id, '2026-11');
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-07')).toMatchObject({
      kind: 'COVERAGE',
      templateName: 'Morning + Evening',
    });
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-14')).toMatchObject({
      templateName: 'Morning + Evening',
    });
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-16')).toMatchObject({
      kind: 'SHIFT',
      templateName: 'Morning',
    });
    expect(
      service.setOverride({
        employeeId: b.value.id,
        date: '2026-11-07',
        kind: 'cancel_coverage',
        reason: 'Manager cancellation',
      }),
    ).toMatchObject({ ok: true });
    calendar = service.calendar(b.value.id, '2026-11');
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-07')).toMatchObject({
      kind: 'SHIFT',
      templateName: 'Evening',
    });
  });

  it('flags coverage needed when both teammates rest', async () => {
    const { service } = await setup();
    const a = service.createEmployee(employee('Employee A', '21'));
    const b = service.createEmployee(employee('Employee B', '22'));
    const templates = service.listTemplates();
    if (!a.ok || !b.ok || !templates.ok) throw new Error('synthetic setup failed');
    for (const employeeId of [a.value.id, b.value.id]) {
      service.createAssignment({
        employeeId,
        templateId: templates.value[0]!.id,
        validFrom: '2026-11-01',
        reason: 'Base schedule',
      });
      service.createRest({
        employeeId,
        weekday: 6,
        validFrom: '2026-11-01',
        reason: 'Saturday rest',
      });
    }
    service.createPair({
      employeeA: a.value.id,
      employeeB: b.value.id,
      validFrom: '2026-11-01',
      reason: 'Coverage pair',
    });
    const calendar = service.calendar(a.value.id, '2026-11');
    expect(calendar.ok && calendar.value.find((day) => day.date === '2026-11-07')).toMatchObject({
      kind: 'COVERAGE_NEEDED',
    });
  });
});
