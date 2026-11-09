import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AuditRepository,
  type Clock,
  DawamDatabase,
  SettingsRepository,
  UserRepository,
} from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthService } from '../src/main/services/auth-service.js';

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

const firstAdmin = {
  username: 'owner',
  password: 'SecurePass1',
  language: 'ar' as const,
  timezone: 'Africa/Cairo',
};

describe('authentication and authorization', () => {
  it('creates exactly one first administrator with scrypt and initial settings', async () => {
    const database = new DawamDatabase();
    const clock: Clock = { now: () => new Date('2026-11-09T00:00:00.000Z') };
    const auth = new AuthService(database, { clock });
    expect(auth.bootstrapState()).toEqual({ needsSetup: true });
    const created = await auth.createFirstAdmin(firstAdmin);
    expect(created).toMatchObject({
      ok: true,
      value: { username: 'owner', role: 'admin', canImport: true },
    });
    expect(auth.bootstrapState()).toEqual({ needsSetup: false });
    expect(await auth.createFirstAdmin(firstAdmin)).toMatchObject({
      ok: false,
      error: { code: 'SETUP_ALREADY_COMPLETE' },
    });

    const stored = new UserRepository(database).findByUsername('OWNER')!;
    expect(stored.passwordHash).not.toContain(firstAdmin.password);
    expect(stored.passwordSalt).not.toBe('');
    const settings = new SettingsRepository(database);
    expect(settings.get('language')).toBe('ar');
    expect(settings.get('timezone')).toBe('Africa/Cairo');
    expect(settings.get('backup_path')).toBeNull();
    expect(new AuditRepository(database, clock).verify()).toEqual({ valid: true });
    database.close();
  });

  it('persists accounts across restart while keeping sessions in memory only', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dawam-auth-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'dawam.sqlite');
    const firstDatabase = new DawamDatabase(path);
    const firstAuth = new AuthService(firstDatabase);
    await firstAuth.createFirstAdmin(firstAdmin);
    firstDatabase.close();

    const secondDatabase = new DawamDatabase(path);
    const secondAuth = new AuthService(secondDatabase);
    expect(secondAuth.currentSession()).toBeNull();
    expect(await secondAuth.login('OWNER', firstAdmin.password)).toMatchObject({
      ok: true,
      value: { username: 'owner', role: 'admin' },
    });
    secondDatabase.close();
  });

  it('lets an administrator reset another saved account password with an audit record', async () => {
    const database = new DawamDatabase();
    const auth = new AuthService(database);
    await auth.createFirstAdmin(firstAdmin);
    const created = await auth.createUser({
      username: 'ahmed',
      password: 'OriginalPass1',
      role: 'admin',
      canImport: true,
      reason: 'Second administrator',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await auth.resetPassword(created.value.id, 'short', 'Reset requested')).toMatchObject({
      ok: false,
      error: { code: 'WEAK_PASSWORD' },
    });
    expect(
      await auth.resetPassword(created.value.id, 'ReplacementPass2', 'Reset requested'),
    ).toMatchObject({ ok: true, value: { username: 'ahmed' } });
    auth.logout();
    expect(await auth.login('ahmed', 'OriginalPass1')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CREDENTIALS' },
    });
    expect(await auth.login('AHMED', 'ReplacementPass2')).toMatchObject({ ok: true });
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
    database.close();
  });

  it('locks repeated failures and allows login after the injected clock expires', async () => {
    const database = new DawamDatabase();
    const clock = new MutableClock(new Date('2026-11-09T00:00:00.000Z'));
    const auth = new AuthService(database, {
      clock,
      maxFailedLogins: 2,
      lockoutMinutes: 10,
    });
    expect(await auth.login('owner', firstAdmin.password)).toMatchObject({
      ok: false,
      error: { code: 'SETUP_REQUIRED' },
    });
    await auth.createFirstAdmin(firstAdmin);
    auth.logout();
    expect(await auth.login('owner', 'WrongPass1')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CREDENTIALS' },
    });
    const locked = await auth.login('owner', 'WrongPass1');
    expect(locked).toMatchObject({ ok: false, error: { code: 'ACCOUNT_LOCKED' } });
    expect(await auth.login('owner', firstAdmin.password)).toMatchObject({
      ok: false,
      error: { code: 'ACCOUNT_LOCKED' },
    });
    clock.advanceMinutes(11);
    expect(await auth.login('owner', firstAdmin.password)).toMatchObject({ ok: true });
    database.close();
  });

  it('enforces the role matrix and configurable import grant in the service layer', async () => {
    const database = new DawamDatabase();
    const auth = new AuthService(database);
    await auth.createFirstAdmin(firstAdmin);
    const employee = await auth.createUser({
      username: 'operator',
      password: 'OperatorPass1',
      role: 'user',
      canImport: false,
      reason: 'Synthetic operator',
    });
    expect(employee.ok).toBe(true);
    if (!employee.ok) return;
    expect(auth.setCanImport(employee.value.id, true, 'Allow USB imports')).toMatchObject({
      ok: true,
      value: { canImport: true },
    });
    auth.logout();
    await auth.login('operator', 'OperatorPass1');
    expect(auth.authorize('attendance.read').ok).toBe(true);
    expect(auth.authorize('import.run').ok).toBe(true);
    expect(auth.authorize('payroll.read')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(auth.listUsers()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    database.close();
  });

  it('prevents removal of the last administrator and audits role changes', async () => {
    const database = new DawamDatabase();
    const auth = new AuthService(database);
    const owner = await auth.createFirstAdmin(firstAdmin);
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;
    expect(auth.setRole(owner.value.id, 'user', 'Demote owner')).toMatchObject({
      ok: false,
      error: { code: 'LAST_ADMIN' },
    });
    const second = await auth.createUser({
      username: 'second-admin',
      password: 'SecondAdmin1',
      role: 'admin',
      canImport: true,
      reason: 'Backup administrator',
    });
    expect(second.ok).toBe(true);
    expect(auth.setRole(owner.value.id, 'user', 'Transfer administration')).toMatchObject({
      ok: true,
      value: { role: 'user' },
    });
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
    database.close();
  });

  it('deactivates secondary accounts safely and stores the current administrator photo', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dawam-profile-'));
    temporaryDirectories.push(directory);
    const database = new DawamDatabase();
    const auth = new AuthService(database, { profilePhotosDirectory: directory });
    const owner = await auth.createFirstAdmin(firstAdmin);
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;
    const second = await auth.createUser({
      username: 'secondary',
      password: 'SecondaryPass1',
      role: 'admin',
      canImport: true,
      reason: 'Secondary administrator',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(auth.setActive(owner.value.id, false, 'Cannot deactivate myself')).toMatchObject({
      ok: false,
      error: { code: 'CANNOT_DEACTIVATE_SELF' },
    });
    expect(auth.setActive(second.value.id, false, 'Secondary no longer needed')).toMatchObject({
      ok: true,
      value: { active: false },
    });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(
      auth.updateOwnPhoto({ mimeType: 'image/png', dataBase64: png.toString('base64') }),
    ).toMatchObject({ ok: true, value: { hasPhoto: true } });
    expect(auth.getUserPhoto(owner.value.id)).toMatchObject({
      ok: true,
      value: { mimeType: 'image/png', dataBase64: png.toString('base64') },
    });
    database.close();
  });
});
