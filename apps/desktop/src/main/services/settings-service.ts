import { AuditRepository, type DawamDatabase, SettingsRepository } from '@dawam/db';
import { rmSync } from 'node:fs';

import type { AuthError, AuthService } from './auth-service.js';
import type { ServiceResult } from './service-result.js';

type SettingsError =
  | AuthError
  | { code: 'INVALID_CONFIRMATION'; messageKey: string }
  | { code: 'INVALID_IDLE_LOCK'; messageKey: string };

export class SettingsService {
  private readonly settings: SettingsRepository;
  private readonly audit: AuditRepository;

  constructor(
    private readonly database: DawamDatabase,
    private readonly auth: AuthService,
    private readonly photosDirectory?: string,
  ) {
    this.settings = new SettingsRepository(database);
    this.audit = new AuditRepository(database);
  }

  getLanguage(): 'ar' | 'en' {
    return this.settings.get('language') === 'en' ? 'en' : 'ar';
  }

  setLanguage(language: 'ar' | 'en'): ServiceResult<'ar' | 'en', AuthError> {
    const session = this.auth.authorize('attendance.read');
    if (!session.ok) return session;
    this.settings.set('language', language);
    return { ok: true, value: language };
  }

  getIdleLockMinutes(): number {
    const value = Number(this.settings.get('idle_lock_minutes') ?? '15');
    return [0, 5, 15, 30, 60].includes(value) ? value : 15;
  }

  setIdleLockMinutes(minutes: number): ServiceResult<number, SettingsError> {
    const session = this.auth.authorize('settings.manage');
    if (!session.ok) return session;
    if (![0, 5, 15, 30, 60].includes(minutes)) {
      return {
        ok: false,
        error: { code: 'INVALID_IDLE_LOCK', messageKey: 'errors.invalid_idle_lock' },
      };
    }
    const before = this.getIdleLockMinutes();
    this.settings.set('idle_lock_minutes', String(minutes));
    this.audit.append({
      actorUserId: session.value.id,
      action: 'settings.idle_lock_updated',
      entity: 'settings',
      entityId: 'idle_lock_minutes',
      before: { minutes: before },
      after: { minutes },
      reason: 'Administrator updated automatic lock timeout',
    });
    return { ok: true, value: minutes };
  }

  /** Wipes employees, punches, schedules and payroll. Keeps users, settings, shift templates and the audit trail. */
  resetAppData(confirmation: string): ServiceResult<{ clearedTables: number }, SettingsError> {
    const session = this.auth.authorize('settings.manage');
    if (!session.ok) return session;
    if (confirmation !== 'RESET')
      return {
        ok: false,
        error: { code: 'INVALID_CONFIRMATION', messageKey: 'settings.wipeFailed' },
      };
    const keep = new Set(['schema_version', 'settings', 'users', 'audit_log', 'shift_templates']);
    const tables = (
      this.database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((row) => row.name)
      .filter((name) => !keep.has(name));
    this.database.connection.exec('PRAGMA foreign_keys=OFF');
    try {
      this.database.transaction(() => {
        for (const name of tables) this.database.connection.exec(`DELETE FROM "${name}"`);
        this.audit.append({
          actorUserId: session.value.id,
          action: 'settings.app_data_reset',
          entity: 'settings',
          after: { clearedTables: tables.length },
          reason: 'Administrator reset all app data',
        });
      });
    } finally {
      this.database.connection.exec('PRAGMA foreign_keys=ON');
    }
    if (this.photosDirectory) rmSync(this.photosDirectory, { recursive: true, force: true });
    return { ok: true, value: { clearedTables: tables.length } };
  }
}
