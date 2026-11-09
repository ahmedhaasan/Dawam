import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import {
  AuditRepository,
  type Clock,
  type DawamDatabase,
  SettingsRepository,
  systemClock,
  type UserRecord,
  UserRepository,
  type UserRole,
} from '@dawam/db';

import { hasPermission, type Permission } from './permissions.js';
import type { ServiceResult } from './service-result.js';

const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 32 } as const;

export interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
  canImport: boolean;
  active: boolean;
  hasPhoto: boolean;
}

export interface FirstAdminInput {
  username: string;
  password: string;
  language: 'ar' | 'en';
  timezone?: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
  canImport: boolean;
  reason: string;
}

export type AuthErrorCode =
  | 'SETUP_ALREADY_COMPLETE'
  | 'SETUP_REQUIRED'
  | 'INVALID_USERNAME'
  | 'WEAK_PASSWORD'
  | 'USERNAME_EXISTS'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_INACTIVE'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'USER_NOT_FOUND'
  | 'LAST_ADMIN'
  | 'CANNOT_DEACTIVATE_SELF'
  | 'INVALID_PHOTO'
  | 'REASON_REQUIRED';

export interface AuthError {
  code: AuthErrorCode;
  messageKey: string;
  lockedUntil?: string;
}

export interface AuthServiceOptions {
  maxFailedLogins?: number;
  lockoutMinutes?: number;
  clock?: Clock;
  profilePhotosDirectory?: string;
}

const error = (code: AuthErrorCode, lockedUntil?: string): AuthError => ({
  code,
  messageKey: `errors.${code.toLowerCase()}`,
  ...(lockedUntil ? { lockedUntil } : {}),
});

const normalizeUsername = (username: string): string => username.trim();

const isStrongPassword = (password: string): boolean =>
  password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);

const toSession = (user: UserRecord): SessionUser => ({
  id: user.id,
  username: user.username,
  role: user.role,
  canImport: user.canImport,
  active: user.active,
  hasPhoto: user.photoPath !== null,
});

const derivePassword = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_PARAMS.keyLength,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: 64 * 1024 * 1024,
      },
      (errorValue, derivedKey) => {
        if (errorValue) reject(errorValue);
        else resolve(derivedKey);
      },
    );
  });

const createPasswordRecord = async (
  password: string,
): Promise<{ hash: string; salt: string; params: string }> => {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return {
    hash: derived.toString('base64'),
    salt: salt.toString('base64'),
    params: JSON.stringify(SCRYPT_PARAMS),
  };
};

const verifyPassword = async (password: string, user: UserRecord): Promise<boolean> => {
  const params = JSON.parse(user.kdfParams) as typeof SCRYPT_PARAMS;
  if (
    params.N !== SCRYPT_PARAMS.N ||
    params.r !== SCRYPT_PARAMS.r ||
    params.p !== SCRYPT_PARAMS.p ||
    params.keyLength !== SCRYPT_PARAMS.keyLength
  ) {
    return false;
  }
  const expected = Buffer.from(user.passwordHash, 'base64');
  const actual = await derivePassword(password, Buffer.from(user.passwordSalt, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export class AuthService {
  private readonly users: UserRepository;
  private readonly settings: SettingsRepository;
  private readonly audit: AuditRepository;
  private readonly clock: Clock;
  private readonly maxFailedLogins: number;
  private readonly lockoutMinutes: number;
  private readonly profilePhotosDirectory: string | null;
  private session: SessionUser | null = null;

  constructor(
    private readonly database: DawamDatabase,
    options: AuthServiceOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.maxFailedLogins = options.maxFailedLogins ?? 5;
    this.lockoutMinutes = options.lockoutMinutes ?? 15;
    this.users = new UserRepository(database);
    this.settings = new SettingsRepository(database);
    this.audit = new AuditRepository(database, this.clock);
    this.profilePhotosDirectory = options.profilePhotosDirectory ?? null;
    if (this.profilePhotosDirectory) mkdirSync(this.profilePhotosDirectory, { recursive: true });
  }

  bootstrapState(): { needsSetup: boolean } {
    return { needsSetup: this.users.count() === 0 };
  }

  currentSession(): SessionUser | null {
    return this.session ? { ...this.session } : null;
  }

  async createFirstAdmin(input: FirstAdminInput): Promise<ServiceResult<SessionUser, AuthError>> {
    if (this.users.count() > 0) return { ok: false, error: error('SETUP_ALREADY_COMPLETE') };
    const username = normalizeUsername(input.username);
    if (username.length < 3) return { ok: false, error: error('INVALID_USERNAME') };
    if (!isStrongPassword(input.password)) return { ok: false, error: error('WEAK_PASSWORD') };
    const password = await createPasswordRecord(input.password);
    const created = this.database.transaction(() => {
      if (this.users.count() > 0) return null;
      const user = this.users.insert({
        username,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        kdfParams: password.params,
        role: 'admin',
        canImport: true,
        createdAt: this.clock.now().toISOString(),
      });
      this.settings.set('language', input.language);
      this.settings.set('timezone', input.timezone ?? 'Africa/Cairo');
      this.audit.append({
        actorUserId: user.id,
        action: 'user.first_admin_created',
        entity: 'user',
        entityId: String(user.id),
        after: { username: user.username, role: user.role, canImport: user.canImport },
        reason: 'first_run_setup',
      });
      return user;
    });
    if (!created) return { ok: false, error: error('SETUP_ALREADY_COMPLETE') };
    this.session = toSession(created);
    return { ok: true, value: { ...this.session } };
  }

  async login(
    usernameInput: string,
    password: string,
  ): Promise<ServiceResult<SessionUser, AuthError>> {
    if (this.users.count() === 0) return { ok: false, error: error('SETUP_REQUIRED') };
    const user = this.users.findByUsername(normalizeUsername(usernameInput));
    if (!user) return { ok: false, error: error('INVALID_CREDENTIALS') };
    if (!user.active) return { ok: false, error: error('ACCOUNT_INACTIVE') };
    const now = this.clock.now();
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > now.getTime()) {
      return { ok: false, error: error('ACCOUNT_LOCKED', user.lockedUntil) };
    }

    const valid = await verifyPassword(password, user);
    if (!valid) {
      const failedLogins = user.failedLogins + 1;
      const lockedUntil =
        failedLogins >= this.maxFailedLogins
          ? new Date(now.getTime() + this.lockoutMinutes * 60_000).toISOString()
          : null;
      this.users.setLoginState(user.id, failedLogins, lockedUntil);
      return {
        ok: false,
        error: lockedUntil ? error('ACCOUNT_LOCKED', lockedUntil) : error('INVALID_CREDENTIALS'),
      };
    }

    this.users.setLoginState(user.id, 0, null);
    const refreshed = this.users.findById(user.id)!;
    this.session = toSession(refreshed);
    return { ok: true, value: { ...this.session } };
  }

  logout(): void {
    this.session = null;
  }

  authorize(permission: Permission): ServiceResult<SessionUser, AuthError> {
    if (!this.session) return { ok: false, error: error('AUTH_REQUIRED') };
    return hasPermission(this.session, permission)
      ? { ok: true, value: { ...this.session } }
      : { ok: false, error: error('FORBIDDEN') };
  }

  async createUser(input: CreateUserInput): Promise<ServiceResult<SessionUser, AuthError>> {
    const actor = this.authorize('users.manage');
    if (!actor.ok) return actor;
    const username = normalizeUsername(input.username);
    if (username.length < 3) return { ok: false, error: error('INVALID_USERNAME') };
    if (!isStrongPassword(input.password)) return { ok: false, error: error('WEAK_PASSWORD') };
    if (!input.reason.trim()) return { ok: false, error: error('REASON_REQUIRED') };
    if (this.users.findByUsername(username)) return { ok: false, error: error('USERNAME_EXISTS') };
    const password = await createPasswordRecord(input.password);
    const user = this.database.transaction(() => {
      const created = this.users.insert({
        username,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        kdfParams: password.params,
        role: input.role,
        canImport: input.canImport,
        createdAt: this.clock.now().toISOString(),
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'user.created',
        entity: 'user',
        entityId: String(created.id),
        after: { username: created.username, role: created.role, canImport: created.canImport },
        reason: input.reason,
      });
      return created;
    });
    return { ok: true, value: toSession(user) };
  }

  listUsers(): ServiceResult<readonly SessionUser[], AuthError> {
    const actor = this.authorize('users.manage');
    if (!actor.ok) return actor;
    return { ok: true, value: this.users.list().map(toSession) };
  }

  async resetPassword(
    userId: number,
    passwordValue: string,
    reason: string,
  ): Promise<ServiceResult<SessionUser, AuthError>> {
    const actor = this.authorize('users.manage');
    if (!actor.ok) return actor;
    if (!isStrongPassword(passwordValue)) {
      return { ok: false, error: error('WEAK_PASSWORD') };
    }
    if (!reason.trim()) return { ok: false, error: error('REASON_REQUIRED') };
    const target = this.users.findById(userId);
    if (!target) return { ok: false, error: error('USER_NOT_FOUND') };
    const password = await createPasswordRecord(passwordValue);
    const updated = this.database.transaction(() => {
      this.users.setPassword(userId, password.hash, password.salt, password.params);
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'user.password_reset',
        entity: 'user',
        entityId: String(userId),
        before: { username: target.username },
        after: { username: target.username, passwordReset: true },
        reason,
      });
      return this.users.findById(userId)!;
    });
    return { ok: true, value: toSession(updated) };
  }

  setRole(userId: number, role: UserRole, reason: string): ServiceResult<SessionUser, AuthError> {
    const actor = this.authorize('users.manage');
    if (!actor.ok) return actor;
    if (!reason.trim()) return { ok: false, error: error('REASON_REQUIRED') };
    const target = this.users.findById(userId);
    if (!target) return { ok: false, error: error('USER_NOT_FOUND') };
    if (target.role === 'admin' && role === 'user' && this.users.countActiveAdmins() === 1) {
      return { ok: false, error: error('LAST_ADMIN') };
    }
    const updated = this.database.transaction(() => {
      this.users.setRole(userId, role);
      const next = this.users.findById(userId)!;
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'user.role_changed',
        entity: 'user',
        entityId: String(userId),
        before: { role: target.role },
        after: { role: next.role },
        reason,
      });
      return next;
    });
    if (this.session?.id === userId) this.session = toSession(updated);
    return { ok: true, value: toSession(updated) };
  }

  setCanImport(
    userId: number,
    canImport: boolean,
    reason: string,
  ): ServiceResult<SessionUser, AuthError> {
    const actor = this.authorize('users.manage');
    if (!actor.ok) return actor;
    if (!reason.trim()) return { ok: false, error: error('REASON_REQUIRED') };
    const target = this.users.findById(userId);
    if (!target) return { ok: false, error: error('USER_NOT_FOUND') };
    const updated = this.database.transaction(() => {
      this.users.setCanImport(userId, canImport);
      const next = this.users.findById(userId)!;
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'user.import_permission_changed',
        entity: 'user',
        entityId: String(userId),
        before: { canImport: target.canImport },
        after: { canImport: next.canImport },
        reason,
      });
      return next;
    });
    if (this.session?.id === userId) this.session = toSession(updated);
    return { ok: true, value: toSession(updated) };
  }

  setActive(
    userId: number,
    active: boolean,
    reason: string,
  ): ServiceResult<SessionUser, AuthError> {
    const actor = this.authorize('users.manage');
    if (!actor.ok) return actor;
    if (!reason.trim()) return { ok: false, error: error('REASON_REQUIRED') };
    const target = this.users.findById(userId);
    if (!target) return { ok: false, error: error('USER_NOT_FOUND') };
    if (!active && actor.value.id === userId)
      return { ok: false, error: error('CANNOT_DEACTIVATE_SELF') };
    if (!active && target.role === 'admin' && this.users.countActiveAdmins() === 1)
      return { ok: false, error: error('LAST_ADMIN') };
    const updated = this.database.transaction(() => {
      this.users.setActive(userId, active);
      const next = this.users.findById(userId)!;
      this.audit.append({
        actorUserId: actor.value.id,
        action: active ? 'user.reactivated' : 'user.deactivated',
        entity: 'user',
        entityId: String(userId),
        before: { active: target.active },
        after: { active: next.active },
        reason,
      });
      return next;
    });
    return { ok: true, value: toSession(updated) };
  }

  getUserPhoto(
    userId: number,
  ): ServiceResult<
    { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; dataBase64: string } | null,
    AuthError
  > {
    const actor = this.authorize('attendance.read');
    if (!actor.ok) return actor;
    if (actor.value.id !== userId && actor.value.role !== 'admin')
      return { ok: false, error: error('FORBIDDEN') };
    const user = this.users.findById(userId);
    if (!user) return { ok: false, error: error('USER_NOT_FOUND') };
    if (!user.photoPath || !this.profilePhotosDirectory) return { ok: true, value: null };
    const root = `${resolve(this.profilePhotosDirectory)}${sep}`;
    const photoPath = resolve(user.photoPath);
    if (!photoPath.startsWith(root) || !existsSync(photoPath)) return { ok: true, value: null };
    const mimeType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    }[extname(photoPath).toLowerCase()] as 'image/jpeg' | 'image/png' | 'image/webp' | undefined;
    if (!mimeType) return { ok: true, value: null };
    return {
      ok: true,
      value: { mimeType, dataBase64: readFileSync(photoPath).toString('base64') },
    };
  }

  updateOwnPhoto(input: {
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    dataBase64: string;
  }): ServiceResult<SessionUser, AuthError> {
    const actor = this.authorize('attendance.read');
    if (!actor.ok) return actor;
    if (!this.profilePhotosDirectory) return { ok: false, error: error('INVALID_PHOTO') };
    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024)
      return { ok: false, error: error('INVALID_PHOTO') };
    const valid =
      (input.mimeType === 'image/jpeg' &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) ||
      (input.mimeType === 'image/png' &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (input.mimeType === 'image/webp' &&
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!valid) return { ok: false, error: error('INVALID_PHOTO') };
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
      input.mimeType
    ];
    const photoPath = join(this.profilePhotosDirectory, `${randomUUID()}.${extension}`);
    writeFileSync(photoPath, bytes, { flag: 'wx' });
    const updated = this.database.transaction(() => {
      const before = this.users.findById(actor.value.id)!;
      this.users.setPhotoPath(actor.value.id, photoPath);
      const next = this.users.findById(actor.value.id)!;
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'user.profile_photo_changed',
        entity: 'user',
        entityId: String(actor.value.id),
        before: { hasPhoto: before.photoPath !== null },
        after: { hasPhoto: true },
        reason: 'Profile photo updated by account owner',
      });
      return next;
    });
    this.session = toSession(updated);
    return { ok: true, value: { ...this.session } };
  }
}
