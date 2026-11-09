import { AuditRepository, DawamDatabase } from '@dawam/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createIpcRouter } from '../src/main/ipc.js';
import { AttendanceService } from '../src/main/services/attendance-service.js';
import { AuthService } from '../src/main/services/auth-service.js';
import { BackupService } from '../src/main/services/backup-service.js';
import { ImportService } from '../src/main/services/import-service.js';
import { PayrollService } from '../src/main/services/payroll-service.js';
import { SettingsService } from '../src/main/services/settings-service.js';
import { WorkforceService } from '../src/main/services/workforce-service.js';
import { IPC_CHANNELS } from '../src/shared/ipc.js';

const databases: DawamDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const createRouter = () => {
  const database = new DawamDatabase();
  databases.push(database);
  const auth = new AuthService(database);
  const directory = mkdtempSync(join(tmpdir(), 'dawam-ipc-'));
  directories.push(directory);
  const attendance = new AttendanceService(database, auth);
  return {
    auth,
    router: createIpcRouter({
      auth,
      settings: new SettingsService(database, auth),
      audit: new AuditRepository(database),
      workforce: new WorkforceService(database, auth, directory),
      imports: new ImportService(database, auth),
      attendance,
      payroll: new PayrollService(database, auth, attendance),
      backup: new BackupService(database, auth, directory, 'test'),
      dialogs: {
        chooseBackupFolder: async () => directory,
        chooseBackupFile: async () => null,
      },
    }),
  };
};

describe('typed IPC router', () => {
  it('rejects malformed and extra fields before invoking a service', async () => {
    const { router } = createRouter();
    expect(
      await router.invoke(IPC_CHANNELS.createFirstAdmin, {
        username: 'x',
        password: 'short',
        language: 'fr',
        unexpected: true,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('runs setup/login routes and keeps user management admin-only', async () => {
    const { auth, router } = createRouter();
    expect(await router.invoke(IPC_CHANNELS.bootstrapState)).toEqual({
      ok: true,
      value: { needsSetup: true },
    });
    await router.invoke(IPC_CHANNELS.createFirstAdmin, {
      username: 'owner',
      password: 'SecurePass1',
      language: 'ar',
    });
    const created = await router.invoke(IPC_CHANNELS.createUser, {
      username: 'operator',
      password: 'OperatorPass1',
      role: 'user',
      canImport: false,
      reason: 'Synthetic test',
    });
    expect(created).toMatchObject({ ok: true, value: { role: 'user' } });
    if (created.ok) {
      expect(
        await router.invoke(IPC_CHANNELS.resetUserPassword, {
          userId: (created.value as { id: number }).id,
          password: 'ReplacementPass2',
          reason: 'Synthetic password reset',
        }),
      ).toMatchObject({ ok: true, value: { username: 'operator' } });
    }
    auth.logout();
    await router.invoke(IPC_CHANNELS.login, {
      username: 'operator',
      password: 'ReplacementPass2',
    });
    expect(await router.invoke(IPC_CHANNELS.listUsers)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await router.invoke(IPC_CHANNELS.verifyAudit)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      await router.invoke(IPC_CHANNELS.createEmployee, {
        fullName: 'Blocked User',
        deviceUserId: '42',
        active: true,
        wageBasisDays: 30,
        reason: 'Synthetic test',
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('validates workforce payloads and exposes the core-backed calendar', async () => {
    const { router } = createRouter();
    await router.invoke(IPC_CHANNELS.createFirstAdmin, {
      username: 'owner',
      password: 'SecurePass1',
      language: 'en',
    });
    expect(
      await router.invoke(IPC_CHANNELS.createEmployee, {
        fullName: 'Synthetic Employee',
        deviceUserId: '001',
        active: true,
        wageBasisDays: 30,
        reason: 'Synthetic test',
        unexpected: true,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const created = await router.invoke(IPC_CHANNELS.createEmployee, {
      fullName: 'Synthetic Employee',
      deviceUserId: '001',
      active: true,
      wageBasisDays: 30,
      reason: 'Synthetic test',
    });
    expect(created).toMatchObject({ ok: true, value: { deviceUserId: '001' } });
    const employeeId = created.ok ? (created.value as { id: number }).id : 0;
    const calendar = await router.invoke(IPC_CHANNELS.getScheduleCalendar, {
      employeeId,
      month: '2026-11',
    });
    expect(calendar).toMatchObject({ ok: true });
  });
});
