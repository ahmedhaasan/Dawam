import type { DawamDatabase } from './database.js';

export type UserRole = 'admin' | 'user';

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  kdfParams: string;
  role: UserRole;
  canImport: boolean;
  active: boolean;
  failedLogins: number;
  lockedUntil: string | null;
  createdAt: string;
  photoPath: string | null;
}

export interface NewUserRecord {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  kdfParams: string;
  role: UserRole;
  canImport: boolean;
  createdAt: string;
}

const mapUser = (row: Record<string, unknown>): UserRecord => ({
  id: Number(row.id),
  username: String(row.username),
  passwordHash: String(row.password_hash),
  passwordSalt: String(row.password_salt),
  kdfParams: String(row.kdf_params),
  role: String(row.role) as UserRole,
  canImport: Number(row.can_import) === 1,
  active: Number(row.active) === 1,
  failedLogins: Number(row.failed_logins),
  lockedUntil: row.locked_until === null ? null : String(row.locked_until),
  createdAt: String(row.created_at),
  photoPath: row.photo_path === null ? null : String(row.photo_path),
});

export class UserRepository {
  constructor(private readonly database: DawamDatabase) {}

  count(): number {
    const row = this.database.connection.prepare('SELECT COUNT(*) AS count FROM users').get() as {
      count: number;
    };
    return Number(row.count);
  }

  countActiveAdmins(): number {
    const row = this.database.connection
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1")
      .get() as { count: number };
    return Number(row.count);
  }

  insert(input: NewUserRecord): UserRecord {
    const result = this.database.connection
      .prepare(
        `INSERT INTO users(
          username,password_hash,password_salt,kdf_params,role,can_import,created_at
        ) VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        input.username,
        input.passwordHash,
        input.passwordSalt,
        input.kdfParams,
        input.role,
        input.canImport ? 1 : 0,
        input.createdAt,
      );
    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): UserRecord | null {
    const row = this.database.connection.prepare('SELECT * FROM users WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    return row ? mapUser(row) : null;
  }

  findByUsername(username: string): UserRecord | null {
    const row = this.database.connection
      .prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE')
      .get(username) as Record<string, unknown> | undefined;
    return row ? mapUser(row) : null;
  }

  list(): readonly UserRecord[] {
    return (
      this.database.connection.prepare('SELECT * FROM users ORDER BY username').all() as Array<
        Record<string, unknown>
      >
    ).map(mapUser);
  }

  setLoginState(id: number, failedLogins: number, lockedUntil: string | null): void {
    this.database.connection
      .prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?')
      .run(failedLogins, lockedUntil, id);
  }

  setPassword(id: number, passwordHash: string, passwordSalt: string, kdfParams: string): void {
    this.database.connection
      .prepare(
        `UPDATE users
         SET password_hash=?, password_salt=?, kdf_params=?, failed_logins=0, locked_until=NULL
         WHERE id=?`,
      )
      .run(passwordHash, passwordSalt, kdfParams, id);
  }

  setRole(id: number, role: UserRole): void {
    this.database.connection.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
  }

  setCanImport(id: number, canImport: boolean): void {
    this.database.connection
      .prepare('UPDATE users SET can_import=? WHERE id=?')
      .run(canImport ? 1 : 0, id);
  }

  setActive(id: number, active: boolean): void {
    this.database.connection
      .prepare('UPDATE users SET active=? WHERE id=?')
      .run(active ? 1 : 0, id);
  }

  setPhotoPath(id: number, photoPath: string): void {
    this.database.connection.prepare('UPDATE users SET photo_path=? WHERE id=?').run(photoPath, id);
  }
}
