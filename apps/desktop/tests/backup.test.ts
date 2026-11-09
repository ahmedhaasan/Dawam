import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DawamDatabase } from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthService } from '../src/main/services/auth-service.js';
import { applyPendingRestore, BackupService } from '../src/main/services/backup-service.js';
import { WorkforceService } from '../src/main/services/workforce-service.js';

const directories: string[] = [];
const databases: DawamDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const fixture = async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'dawam-backup-test-'));
  directories.push(dataDirectory);
  const database = new DawamDatabase(join(dataDirectory, 'dawam.sqlite'));
  databases.push(database);
  const auth = new AuthService(database, {
    profilePhotosDirectory: join(dataDirectory, 'user-photos'),
  });
  await auth.createFirstAdmin({ username: 'owner', password: 'SecurePass1', language: 'en' });
  const workforce = new WorkforceService(database, auth, join(dataDirectory, 'photos'));
  return { dataDirectory, database, auth, workforce };
};

describe('encrypted backup and staged restore', () => {
  it('round-trips the database and files after a safe restart boundary', async () => {
    const { dataDirectory, database, auth, workforce } = await fixture();
    const first = workforce.createEmployee({
      fullName: 'First Employee',
      deviceUserId: '1',
      active: true,
      wageBasisDays: 30,
      reason: 'Backup fixture',
    });
    expect(first.ok).toBe(true);
    mkdirSync(join(dataDirectory, 'photos'), { recursive: true });
    writeFileSync(join(dataDirectory, 'photos', 'fixture.bin'), 'photo-fixture');

    const destination = join(dataDirectory, 'exports');
    const service = new BackupService(database, auth, dataDirectory, 'test-version');
    const created = await service.create(destination, 'BackupPass1');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(existsSync(created.value.path)).toBe(true);
    expect(readFileSync(created.value.path, 'utf8')).not.toContain('First Employee');

    workforce.createEmployee({
      fullName: 'Second Employee',
      deviceUserId: '2',
      active: true,
      wageBasisDays: 30,
      reason: 'Post-backup mutation',
    });
    const staged = await service.stageRestore(created.value.path, 'BackupPass1');
    expect(staged).toMatchObject({ ok: true, value: { restartRequired: true } });
    if (!staged.ok) return;
    expect(existsSync(staged.value.safetyBackupPath)).toBe(true);

    databases.pop()!.close();
    expect(applyPendingRestore(dataDirectory)).toBe(true);
    const restored = new DawamDatabase(join(dataDirectory, 'dawam.sqlite'));
    databases.push(restored);
    const count = restored.connection.prepare('SELECT COUNT(*) AS count FROM employees').get() as {
      count: number;
    };
    expect(Number(count.count)).toBe(1);
    expect(readFileSync(join(dataDirectory, 'photos', 'fixture.bin'), 'utf8')).toBe(
      'photo-fixture',
    );
    expect(applyPendingRestore(dataDirectory)).toBe(false);
  });

  it('rejects an incorrect password without staging a restore', async () => {
    const { dataDirectory, database, auth } = await fixture();
    const service = new BackupService(database, auth, dataDirectory, 'test-version');
    const created = await service.create(join(dataDirectory, 'exports'), 'BackupPass1');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await service.stageRestore(created.value.path, 'WrongPass22');
    expect(result).toMatchObject({ ok: false, error: { code: 'BACKUP_INVALID_OR_PASSWORD' } });
    expect(existsSync(join(dataDirectory, 'pending-restore.json'))).toBe(false);
  });
});
