import { AuditRepository, type DawamDatabase, SettingsRepository } from '@dawam/db';

import type { AuthError, AuthService } from './auth-service.js';
import type { ServiceResult } from './service-result.js';

type SettingsError = AuthError | { code: 'INVALID_IDLE_LOCK'; messageKey: string };

export class SettingsService {
  private readonly settings: SettingsRepository;
  private readonly audit: AuditRepository;

  constructor(
    database: DawamDatabase,
    private readonly auth: AuthService,
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
}
