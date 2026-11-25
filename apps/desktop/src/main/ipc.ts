import type { IpcMain } from 'electron';

import type { AuditRepository } from '@dawam/db';

import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcError,
  type IpcResult,
  ipcSchemas,
} from '../shared/ipc.js';
import type { AuthService } from './services/auth-service.js';
import type { AttendanceService } from './services/attendance-service.js';
import type { BackupService } from './services/backup-service.js';
import type { ImportService } from './services/import-service.js';
import type { PayrollService } from './services/payroll-service.js';
import type { SettingsService } from './services/settings-service.js';
import type { WorkforceService } from './services/workforce-service.js';

export interface IpcServices {
  auth: AuthService;
  settings: SettingsService;
  audit: AuditRepository;
  workforce: WorkforceService;
  imports: ImportService;
  attendance: AttendanceService;
  payroll: PayrollService;
  backup: BackupService;
  dialogs: {
    chooseBackupFolder(): Promise<string | null>;
    chooseBackupFile(): Promise<string | null>;
  };
}

const validationError = (
  issues: readonly { path: PropertyKey[]; message: string }[],
): IpcError => ({
  code: 'VALIDATION_ERROR',
  messageKey: 'errors.validation_error',
  details: issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
});

const ok = <T>(value: T): IpcResult<T> => ({ ok: true, value });

export interface IpcRouter {
  invoke(channel: IpcChannel, payload?: unknown): Promise<IpcResult<unknown>>;
}

export const createIpcRouter = (services: IpcServices): IpcRouter => ({
  async invoke(channel, payload) {
    const parsed = ipcSchemas[channel].safeParse(payload);
    if (!parsed.success) return { ok: false, error: validationError(parsed.error.issues) };

    switch (channel) {
      case IPC_CHANNELS.bootstrapState:
        return ok(services.auth.bootstrapState());
      case IPC_CHANNELS.createFirstAdmin:
        return services.auth.createFirstAdmin(
          parsed.data as Parameters<AuthService['createFirstAdmin']>[0],
        );
      case IPC_CHANNELS.login: {
        const input = parsed.data as { username: string; password: string };
        return services.auth.login(input.username, input.password);
      }
      case IPC_CHANNELS.logout:
        services.auth.logout();
        return ok(true);
      case IPC_CHANNELS.currentSession:
        return ok(services.auth.currentSession());
      case IPC_CHANNELS.createUser:
        return services.auth.createUser(parsed.data as Parameters<AuthService['createUser']>[0]);
      case IPC_CHANNELS.listUsers:
        return services.auth.listUsers();
      case IPC_CHANNELS.setUserRole: {
        const input = parsed.data as {
          userId: number;
          role: 'admin' | 'user';
          reason: string;
        };
        return services.auth.setRole(input.userId, input.role, input.reason);
      }
      case IPC_CHANNELS.setUserCanImport: {
        const input = parsed.data as { userId: number; canImport: boolean; reason: string };
        return services.auth.setCanImport(input.userId, input.canImport, input.reason);
      }
      case IPC_CHANNELS.setUserActive: {
        const input = parsed.data as { userId: number; active: boolean; reason: string };
        return services.auth.setActive(input.userId, input.active, input.reason);
      }
      case IPC_CHANNELS.resetUserPassword: {
        const input = parsed.data as { userId: number; password: string; reason: string };
        return services.auth.resetPassword(input.userId, input.password, input.reason);
      }
      case IPC_CHANNELS.getUserPhoto: {
        const input = parsed.data as { userId: number };
        return services.auth.getUserPhoto(input.userId);
      }
      case IPC_CHANNELS.updateOwnPhoto:
        return services.auth.updateOwnPhoto(
          parsed.data as Parameters<AuthService['updateOwnPhoto']>[0],
        );
      case IPC_CHANNELS.getLanguage:
        return ok(services.settings.getLanguage());
      case IPC_CHANNELS.setLanguage: {
        const input = parsed.data as { language: 'ar' | 'en' };
        return services.settings.setLanguage(input.language);
      }
      case IPC_CHANNELS.getIdleLockMinutes:
        return ok(services.settings.getIdleLockMinutes());
      case IPC_CHANNELS.setIdleLockMinutes: {
        const input = parsed.data as { minutes: number };
        return services.settings.setIdleLockMinutes(input.minutes);
      }
      case IPC_CHANNELS.verifyAudit: {
        const authorized = services.auth.authorize('audit.read');
        return authorized.ok ? ok(services.audit.verify()) : authorized;
      }
      case IPC_CHANNELS.listAudit: {
        const authorized = services.auth.authorize('audit.read');
        if (!authorized.ok) return authorized;
        const input = parsed.data as { entity?: string; action?: string; limit: number };
        const rows = services.audit
          .list()
          .filter((row) => !input.entity || row.entity.includes(input.entity))
          .filter((row) => !input.action || row.action.includes(input.action))
          .slice(-input.limit)
          .reverse()
          .map(({ id, ts, actorUserId, action, entity, entityId, reason }) => ({
            id,
            ts,
            actorUserId,
            action,
            entity,
            entityId,
            reason,
          }));
        return ok(rows);
      }
      case IPC_CHANNELS.resetAudit: {
        const authorized = services.auth.authorize('audit.read');
        if (!authorized.ok) return authorized;
        const input = parsed.data as { reason: string; confirmation: 'RESET' };
        const result = services.audit.reset({
          actorUserId: authorized.value.id,
          reason: input.reason,
        });
        return ok({ deletedCount: result.deletedCount });
      }
      case IPC_CHANNELS.resetAppData: {
        const input = parsed.data as { confirmation: string };
        return services.settings.resetAppData(input.confirmation);
      }
      case IPC_CHANNELS.chooseBackupFolder: {
        const authorized = services.auth.authorize('backup.manage');
        return authorized.ok ? ok(await services.dialogs.chooseBackupFolder()) : authorized;
      }
      case IPC_CHANNELS.chooseBackupFile: {
        const authorized = services.auth.authorize('backup.manage');
        return authorized.ok ? ok(await services.dialogs.chooseBackupFile()) : authorized;
      }
      case IPC_CHANNELS.createBackup: {
        const input = parsed.data as { directory: string; password: string };
        return services.backup.create(input.directory, input.password);
      }
      case IPC_CHANNELS.stageRestore: {
        const input = parsed.data as { path: string; password: string };
        return services.backup.stageRestore(input.path, input.password);
      }
      case IPC_CHANNELS.listEmployees:
        return services.workforce.listEmployees();
      case IPC_CHANNELS.getEmployeePhoto: {
        const input = parsed.data as { employeeId: number };
        return services.workforce.getEmployeePhoto(input.employeeId);
      }
      case IPC_CHANNELS.getEmployeeSchedule: {
        const input = parsed.data as { employeeId: number; date: string };
        return services.workforce.getEmployeeSchedule(input.employeeId, input.date);
      }
      case IPC_CHANNELS.updateEmployeeSchedule:
        return services.workforce.updateEmployeeSchedule(
          parsed.data as Parameters<WorkforceService['updateEmployeeSchedule']>[0],
        );
      case IPC_CHANNELS.createEmployee:
        return services.workforce.createEmployee(
          parsed.data as Parameters<WorkforceService['createEmployee']>[0],
        );
      case IPC_CHANNELS.updateEmployee: {
        const input = parsed.data as Parameters<WorkforceService['updateEmployee']>[1] & {
          id: number;
        };
        const { id, ...employee } = input;
        return services.workforce.updateEmployee(id, employee);
      }
      case IPC_CHANNELS.deleteEmployee: {
        const input = parsed.data as { employeeId: number; reason: string; confirmation: string };
        return services.workforce.deleteEmployee(
          input.employeeId,
          input.reason,
          input.confirmation,
        );
      }
      case IPC_CHANNELS.employeePurgePreview:
        return services.workforce.employeePurgePreview(
          (parsed.data as { employeeId: number }).employeeId,
        );
      case IPC_CHANNELS.listShiftTemplates:
        return services.workforce.listTemplates();
      case IPC_CHANNELS.createShiftTemplate:
        return services.workforce.createTemplate(
          parsed.data as Parameters<WorkforceService['createTemplate']>[0],
        );
      case IPC_CHANNELS.updateShiftTemplate: {
        const input = parsed.data as Parameters<WorkforceService['updateTemplate']>[1] & {
          id: number;
        };
        const { id, ...template } = input;
        return services.workforce.updateTemplate(id, template);
      }
      case IPC_CHANNELS.createShiftAssignment:
        return services.workforce.createAssignment(
          parsed.data as Parameters<WorkforceService['createAssignment']>[0],
        );
      case IPC_CHANNELS.createWeeklyRest:
        return services.workforce.createRest(
          parsed.data as Parameters<WorkforceService['createRest']>[0],
        );
      case IPC_CHANNELS.createTeammatePair:
        return services.workforce.createPair(
          parsed.data as Parameters<WorkforceService['createPair']>[0],
        );
      case IPC_CHANNELS.setScheduleOverride:
        return services.workforce.setOverride(
          parsed.data as Parameters<WorkforceService['setOverride']>[0],
        );
      case IPC_CHANNELS.createLeave:
        return services.workforce.createLeave(
          parsed.data as Parameters<WorkforceService['createLeave']>[0],
        );
      case IPC_CHANNELS.getScheduleCalendar: {
        const input = parsed.data as { employeeId: number; month: string };
        return services.workforce.calendar(input.employeeId, input.month);
      }
      case IPC_CHANNELS.previewAttendanceImport:
        return services.imports.preview(parsed.data as Parameters<ImportService['preview']>[0]);
      case IPC_CHANNELS.commitAttendanceImport:
        return services.imports.commit(parsed.data as Parameters<ImportService['commit']>[0]);
      case IPC_CHANNELS.listQuarantinedPunches:
        return services.imports.listQuarantined();
      case IPC_CHANNELS.resolveQuarantinedPunch:
        return services.imports.resolveQuarantined(
          parsed.data as Parameters<ImportService['resolveQuarantined']>[0],
        );
      case IPC_CHANNELS.ignoreQuarantinedDeviceId:
        return services.imports.ignoreDeviceId(
          parsed.data as Parameters<ImportService['ignoreDeviceId']>[0],
        );
      case IPC_CHANNELS.getAttendanceMonth: {
        const input = parsed.data as { employeeId: number; month: string };
        return services.attendance.month(input.employeeId, input.month);
      }
      case IPC_CHANNELS.setPunchCorrection:
        return services.attendance.correct(
          parsed.data as Parameters<AttendanceService['correct']>[0],
        );
      case IPC_CHANNELS.listPayrollPolicies:
        return services.payroll.listPolicies();
      case IPC_CHANNELS.createPayrollPolicy:
        return services.payroll.createPolicy(
          parsed.data as Parameters<PayrollService['createPolicy']>[0],
        );
      case IPC_CHANNELS.previewPayroll: {
        const input = parsed.data as {
          employeeId: number;
          month: string;
          policyId: number;
          deductionByDate?: Readonly<Record<string, 'none' | 'exact' | 'hour_up' | 'full_day'>>;
          dateDecisions?: Parameters<PayrollService['preview']>[4];
          salaryOverrideMinor?: number;
        };
        return services.payroll.preview(
          input.employeeId,
          input.month,
          input.policyId,
          input.deductionByDate,
          input.dateDecisions,
          input.salaryOverrideMinor,
        );
      }
      case IPC_CHANNELS.approvePayroll:
        return services.payroll.approve(parsed.data as Parameters<PayrollService['approve']>[0]);
      case IPC_CHANNELS.listPayrollRuns: {
        const input = parsed.data as { employeeId: number; month: string };
        return services.payroll.listRuns(input.employeeId, input.month);
      }
      case IPC_CHANNELS.voidPayrollRun: {
        const input = parsed.data as { runId: number; reason: string };
        return services.payroll.voidRun(input.runId, input.reason);
      }
    }
  },
});

export const registerIpcHandlers = (ipcMain: IpcMain, services: IpcServices): void => {
  const router = createIpcRouter(services);
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, (_event, payload: unknown) => router.invoke(channel, payload));
  }
};
