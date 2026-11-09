import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';

import { AuditRepository, type DawamDatabase } from '@dawam/db';

import type { AuthError, AuthService } from './auth-service.js';
import type { ServiceResult } from './service-result.js';

const FORMAT = 'dawam-backup-v1';
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 1_000;

interface BackupFile {
  path: string;
  bytes: number;
  sha256: string;
  dataBase64: string;
}

interface BackupManifest {
  format: typeof FORMAT;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  databaseSha256: string;
  files: Array<Pick<BackupFile, 'path' | 'bytes' | 'sha256'>>;
}

interface BackupPayload {
  manifest: BackupManifest;
  databaseBase64: string;
  files: BackupFile[];
}

interface EncryptedBackup {
  format: typeof FORMAT;
  encryption: 'aes-256-gcm+scrypt';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface BackupInfo {
  path: string;
  createdAt: string;
  schemaVersion: number;
  counts: Record<string, number>;
}

export type BackupError = AuthError | { code: string; messageKey: string };

const failure = (code: string): BackupError => ({
  code,
  messageKey: `errors.${code.toLowerCase()}`,
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const safeRelativePath = (value: string): boolean =>
  /^(photos|user-photos)\/[A-Za-z0-9._-]+$/.test(value) && !value.includes('..');

const databaseCounts = (database: DawamDatabase): Record<string, number> => {
  const names = ['users', 'employees', 'raw_punches', 'payroll_policies', 'payroll_runs'];
  return Object.fromEntries(
    names.map((name) => {
      const row = database.connection.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get() as {
        count: number;
      };
      return [name, Number(row.count)];
    }),
  );
};

const directoryFiles = (dataDirectory: string, directoryName: string): BackupFile[] => {
  const directory = join(dataDirectory, directoryName);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const bytes = readFileSync(join(directory, entry.name));
      return {
        path: `${directoryName}/${entry.name}`,
        bytes: bytes.length,
        sha256: sha256(bytes),
        dataBase64: bytes.toString('base64'),
      };
    });
};

const encrypt = (payload: BackupPayload, password: string): EncryptedBackup => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: FORMAT,
    encryption: 'aes-256-gcm+scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
};

const decrypt = (archive: EncryptedBackup, password: string): BackupPayload => {
  if (archive.format !== FORMAT || archive.encryption !== 'aes-256-gcm+scrypt') {
    throw new Error('invalid format');
  }
  const salt = Buffer.from(archive.salt, 'base64');
  const iv = Buffer.from(archive.iv, 'base64');
  const tag = Buffer.from(archive.tag, 'base64');
  const ciphertext = Buffer.from(archive.ciphertext, 'base64');
  const key = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(),
  ) as BackupPayload;
};

const validatePayload = (payload: BackupPayload, currentSchemaVersion: number): void => {
  if (payload.manifest.format !== FORMAT || payload.manifest.schemaVersion > currentSchemaVersion)
    throw new Error('newer schema');
  if (payload.files.length > MAX_FILES) throw new Error('too many files');
  const databaseBytes = Buffer.from(payload.databaseBase64, 'base64');
  if (databaseBytes.length === 0 || sha256(databaseBytes) !== payload.manifest.databaseSha256)
    throw new Error('database checksum');
  const manifestFiles = new Map(payload.manifest.files.map((file) => [file.path, file]));
  for (const file of payload.files) {
    if (!safeRelativePath(file.path)) throw new Error('unsafe path');
    const bytes = Buffer.from(file.dataBase64, 'base64');
    const manifest = manifestFiles.get(file.path);
    if (!manifest || bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      throw new Error('file checksum');
  }
};

export class BackupService {
  private readonly audit: AuditRepository;

  constructor(
    private readonly database: DawamDatabase,
    private readonly auth: AuthService,
    private readonly dataDirectory: string,
    private readonly appVersion: string,
  ) {
    this.audit = new AuditRepository(database);
  }

  async create(
    destinationDirectory: string,
    password: string,
    reason = 'Encrypted backup created',
  ): Promise<ServiceResult<BackupInfo, BackupError>> {
    const actor = this.auth.authorize('backup.manage');
    if (!actor.ok) return actor;
    if (password.length < 10) return { ok: false, error: failure('WEAK_BACKUP_PASSWORD') };
    const destination = resolve(destinationDirectory);
    mkdirSync(destination, { recursive: true });
    const temporary = mkdtempSync(join(tmpdir(), 'dawam-backup-'));
    try {
      const databasePath = join(temporary, 'dawam.sqlite');
      await backup(this.database.connection, databasePath);
      const databaseBytes = readFileSync(databasePath);
      const files = [
        ...directoryFiles(this.dataDirectory, 'photos'),
        ...directoryFiles(this.dataDirectory, 'user-photos'),
      ];
      const createdAt = new Date().toISOString();
      const manifest: BackupManifest = {
        format: FORMAT,
        createdAt,
        appVersion: this.appVersion,
        schemaVersion: this.database.schemaVersion(),
        counts: databaseCounts(this.database),
        databaseSha256: sha256(databaseBytes),
        files: files.map(({ path, bytes, sha256: checksum }) => ({
          path,
          bytes,
          sha256: checksum,
        })),
      };
      const encrypted = encrypt(
        { manifest, databaseBase64: databaseBytes.toString('base64'), files },
        password,
      );
      const stamp = createdAt.replace(/[:.]/g, '-');
      const outputPath = join(destination, `Dawam-${stamp}.dawam-backup`);
      writeFileSync(outputPath, JSON.stringify(encrypted), { flag: 'wx' });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'backup.created',
        entity: 'backup',
        entityId: basename(outputPath),
        after: { schemaVersion: manifest.schemaVersion, counts: manifest.counts },
        reason,
      });
      return {
        ok: true,
        value: {
          path: outputPath,
          createdAt,
          schemaVersion: manifest.schemaVersion,
          counts: manifest.counts,
        },
      };
    } catch {
      return { ok: false, error: failure('BACKUP_FAILED') };
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  async stageRestore(
    archivePath: string,
    password: string,
  ): Promise<ServiceResult<{ restartRequired: true; safetyBackupPath: string }, BackupError>> {
    const actor = this.auth.authorize('backup.manage');
    if (!actor.ok) return actor;
    try {
      const resolvedArchive = resolve(archivePath);
      if (!existsSync(resolvedArchive) || statSync(resolvedArchive).size > MAX_BACKUP_BYTES)
        return { ok: false, error: failure('BACKUP_INVALID') };
      const archive = JSON.parse(readFileSync(resolvedArchive, 'utf8')) as EncryptedBackup;
      const payload = decrypt(archive, password);
      validatePayload(payload, this.database.schemaVersion());
      const staging = join(this.dataDirectory, `restore-staging-${randomUUID()}`);
      mkdirSync(staging, { recursive: true });
      writeFileSync(join(staging, 'dawam.sqlite'), Buffer.from(payload.databaseBase64, 'base64'));
      for (const file of payload.files) {
        const target = join(staging, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(file.dataBase64, 'base64'), { flag: 'wx' });
      }
      const stagedDatabase = new DatabaseSync(join(staging, 'dawam.sqlite'), { readOnly: true });
      const integrity = stagedDatabase.prepare('PRAGMA integrity_check').get() as {
        integrity_check: string;
      };
      const foreignKeys = stagedDatabase.prepare('PRAGMA foreign_key_check').all();
      stagedDatabase.close();
      if (integrity.integrity_check !== 'ok' || foreignKeys.length > 0)
        throw new Error('integrity');
      const safetyDirectory = join(this.dataDirectory, 'backups', 'pre-restore');
      const safety = await this.create(safetyDirectory, password, 'Automatic pre-restore backup');
      if (!safety.ok) throw new Error('safety backup');
      writeFileSync(
        join(this.dataDirectory, 'pending-restore.json'),
        JSON.stringify({ staging, requestedAt: new Date().toISOString() }),
        { flag: 'wx' },
      );
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'backup.restore_staged',
        entity: 'backup',
        entityId: basename(resolvedArchive),
        after: { safetyBackup: basename(safety.value.path) },
        reason: 'Administrator confirmed restore',
      });
      return {
        ok: true,
        value: { restartRequired: true, safetyBackupPath: safety.value.path },
      };
    } catch {
      return { ok: false, error: failure('BACKUP_INVALID_OR_PASSWORD') };
    }
  }
}

export const applyPendingRestore = (dataDirectory: string): boolean => {
  const pendingPath = join(dataDirectory, 'pending-restore.json');
  if (!existsSync(pendingPath)) return false;
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8')) as { staging: string };
  const root = `${resolve(dataDirectory)}${sep}`;
  const staging = resolve(pending.staging);
  if (!staging.startsWith(root) || !basename(staging).startsWith('restore-staging-')) {
    throw new Error('Unsafe restore staging path');
  }
  const stagedDatabase = join(staging, 'dawam.sqlite');
  if (!existsSync(stagedDatabase)) throw new Error('Missing staged database');
  for (const name of ['dawam.sqlite', 'dawam.sqlite-wal', 'dawam.sqlite-shm']) {
    rmSync(join(dataDirectory, name), { force: true });
  }
  copyFileSync(stagedDatabase, join(dataDirectory, 'dawam.sqlite'));
  for (const directoryName of ['photos', 'user-photos']) {
    const target = join(dataDirectory, directoryName);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const source = join(staging, directoryName);
    if (!existsSync(source)) continue;
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isFile()) copyFileSync(join(source, entry.name), join(target, entry.name));
    }
  }
  const restored = new DatabaseSync(join(dataDirectory, 'dawam.sqlite'));
  for (const [table, directoryName] of [
    ['employees', 'photos'],
    ['users', 'user-photos'],
  ] as const) {
    const rows = restored
      .prepare(`SELECT id, photo_path FROM ${table} WHERE photo_path IS NOT NULL`)
      .all() as Array<{ id: number; photo_path: string }>;
    for (const row of rows) {
      restored
        .prepare(`UPDATE ${table} SET photo_path=? WHERE id=?`)
        .run(join(dataDirectory, directoryName, basename(row.photo_path)), row.id);
    }
  }
  restored.close();
  rmSync(staging, { recursive: true, force: true });
  rmSync(pendingPath, { force: true });
  return true;
};
