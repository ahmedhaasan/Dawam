import { z } from 'zod';

export const IPC_CHANNELS = {
  bootstrapState: 'app:bootstrap-state',
  createFirstAdmin: 'auth:create-first-admin',
  login: 'auth:login',
  logout: 'auth:logout',
  currentSession: 'auth:current-session',
  createUser: 'users:create',
  listUsers: 'users:list',
  setUserRole: 'users:set-role',
  setUserCanImport: 'users:set-can-import',
  setUserActive: 'users:set-active',
  resetUserPassword: 'users:reset-password',
  getUserPhoto: 'users:photo:get',
  updateOwnPhoto: 'users:photo:update-own',
  getLanguage: 'settings:get-language',
  setLanguage: 'settings:set-language',
  getIdleLockMinutes: 'settings:get-idle-lock-minutes',
  setIdleLockMinutes: 'settings:set-idle-lock-minutes',
  verifyAudit: 'audit:verify',
  listAudit: 'audit:list',
  chooseBackupFolder: 'backup:choose-folder',
  chooseBackupFile: 'backup:choose-file',
  createBackup: 'backup:create',
  stageRestore: 'backup:restore-stage',
  listEmployees: 'workforce:employees:list',
  getEmployeePhoto: 'workforce:employees:photo',
  getEmployeeSchedule: 'workforce:employees:schedule:get',
  updateEmployeeSchedule: 'workforce:employees:schedule:update',
  createEmployee: 'workforce:employees:create',
  updateEmployee: 'workforce:employees:update',
  deleteEmployee: 'workforce:employees:delete',
  listShiftTemplates: 'workforce:templates:list',
  createShiftTemplate: 'workforce:templates:create',
  updateShiftTemplate: 'workforce:templates:update',
  createShiftAssignment: 'workforce:assignments:create',
  createWeeklyRest: 'workforce:rests:create',
  createTeammatePair: 'workforce:pairs:create',
  setScheduleOverride: 'workforce:overrides:set',
  createLeave: 'workforce:leaves:create',
  getScheduleCalendar: 'workforce:calendar:get',
  previewAttendanceImport: 'imports:preview',
  commitAttendanceImport: 'imports:commit',
  listQuarantinedPunches: 'imports:quarantine:list',
  resolveQuarantinedPunch: 'imports:quarantine:resolve',
  getAttendanceMonth: 'attendance:month:get',
  setPunchCorrection: 'attendance:correction:set',
  listPayrollPolicies: 'payroll:policies:list',
  createPayrollPolicy: 'payroll:policies:create',
  previewPayroll: 'payroll:preview',
  approvePayroll: 'payroll:approve',
  listPayrollRuns: 'payroll:runs:list',
  voidPayrollRun: 'payroll:runs:void',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const username = z.string().trim().min(3).max(64);
const password = z.string().min(10).max(256);
const reason = z.string().trim().min(1).max(500);
const id = z.number().int().positive();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
const optionalDate = localDate.nullish();
const photo = z
  .object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    dataBase64: z.string().min(1).max(7_500_000),
  })
  .strict();
const employeeInput = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    deviceUserId: z.string().trim().min(1).max(100),
    hireDate: optionalDate,
    active: z.boolean(),
    monthlySalaryMinor: z.number().int().nonnegative().nullable().optional(),
    wageBasisDays: z.number().int().min(1).max(366),
    photo: photo.optional(),
    reason,
  })
  .strict();
const templateInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    active: z.boolean(),
    startMin: z.number().int().min(0).max(2879),
    endMin: z.number().int().min(1).max(2879),
    inFromMin: z.number().int().min(-1440).max(2879),
    inToMin: z.number().int().min(-1440).max(2879),
    outFromMin: z.number().int().min(0).max(4319),
    outToMin: z.number().int().min(0).max(4319),
    reason,
  })
  .strict();
const payrollPolicy = z.discriminatedUnion('id', [
  z.object({ id: z.literal('none') }).strict(),
  z
    .object({ id: z.literal('fixed_hourly_amount'), amountMinor: z.number().int().nonnegative() })
    .strict(),
  z
    .object({
      id: z.literal('fixed_hourly_rounded_up'),
      amountMinor: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ id: z.literal('hourly_proportional') }).strict(),
  z.object({ id: z.literal('hourly_rounded_up') }).strict(),
  z.object({ id: z.literal('day_per_started_hour') }).strict(),
  z.object({ id: z.literal('day_any_lateness') }).strict(),
  z
    .object({ id: z.literal('day_at_threshold'), thresholdMinutes: z.number().int().nonnegative() })
    .strict(),
  z
    .object({
      id: z.literal('custom_tiers'),
      tiers: z.array(
        z
          .object({
            fromMin: z.number().int().nonnegative(),
            toMin: z.number().int().nonnegative().nullable(),
            amountMinor: z.number().int().nonnegative().optional(),
            fractionOfDaily: z
              .object({
                numerator: z.number().int().nonnegative(),
                denominator: z.number().int().positive(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ),
    })
    .strict(),
]);
const payrollConfig = z
  .object({
    policy: payrollPolicy,
    options: z
      .object({
        graceMinutes: z.number().int().nonnegative().optional(),
        graceMode: z.enum(['threshold', 'subtract']).optional(),
        capPerDateMinor: z.number().int().nonnegative().nullable().optional(),
        hourlyBasis: z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('scheduled_shift') }).strict(),
            z.object({ kind: z.literal('fixed'), minutes: z.number().int().positive() }).strict(),
          ])
          .optional(),
        absenceMultiplier: z
          .object({
            numerator: z.number().int().nonnegative(),
            denominator: z.number().int().positive(),
          })
          .strict()
          .optional(),
        otherApprovedItemsMinor: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ipcSchemas = {
  [IPC_CHANNELS.bootstrapState]: z.unknown(),
  [IPC_CHANNELS.createFirstAdmin]: z
    .object({
      username,
      password,
      language: z.enum(['ar', 'en']),
      timezone: z.string().min(1).max(100).optional(),
    })
    .strict(),
  [IPC_CHANNELS.login]: z.object({ username, password }).strict(),
  [IPC_CHANNELS.logout]: z.unknown(),
  [IPC_CHANNELS.currentSession]: z.unknown(),
  [IPC_CHANNELS.createUser]: z
    .object({
      username,
      password,
      role: z.enum(['admin', 'user']),
      canImport: z.boolean(),
      reason,
    })
    .strict(),
  [IPC_CHANNELS.listUsers]: z.unknown(),
  [IPC_CHANNELS.setUserRole]: z
    .object({ userId: z.number().int().positive(), role: z.enum(['admin', 'user']), reason })
    .strict(),
  [IPC_CHANNELS.setUserCanImport]: z
    .object({ userId: z.number().int().positive(), canImport: z.boolean(), reason })
    .strict(),
  [IPC_CHANNELS.setUserActive]: z.object({ userId: id, active: z.boolean(), reason }).strict(),
  [IPC_CHANNELS.resetUserPassword]: z.object({ userId: id, password, reason }).strict(),
  [IPC_CHANNELS.getUserPhoto]: z.object({ userId: id }).strict(),
  [IPC_CHANNELS.updateOwnPhoto]: photo,
  [IPC_CHANNELS.getLanguage]: z.unknown(),
  [IPC_CHANNELS.setLanguage]: z.object({ language: z.enum(['ar', 'en']) }).strict(),
  [IPC_CHANNELS.getIdleLockMinutes]: z.unknown(),
  [IPC_CHANNELS.setIdleLockMinutes]: z
    .object({
      minutes: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
    })
    .strict(),
  [IPC_CHANNELS.verifyAudit]: z.unknown(),
  [IPC_CHANNELS.listAudit]: z
    .object({
      entity: z.string().trim().max(100).optional(),
      action: z.string().trim().max(100).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    })
    .strict(),
  [IPC_CHANNELS.chooseBackupFolder]: z.unknown(),
  [IPC_CHANNELS.chooseBackupFile]: z.unknown(),
  [IPC_CHANNELS.createBackup]: z
    .object({ directory: z.string().trim().min(1).max(4096), password })
    .strict(),
  [IPC_CHANNELS.stageRestore]: z
    .object({ path: z.string().trim().min(1).max(4096), password })
    .strict(),
  [IPC_CHANNELS.listEmployees]: z.unknown(),
  [IPC_CHANNELS.getEmployeePhoto]: z.object({ employeeId: id }).strict(),
  [IPC_CHANNELS.getEmployeeSchedule]: z.object({ employeeId: id, date: localDate }).strict(),
  [IPC_CHANNELS.updateEmployeeSchedule]: z
    .object({
      employeeId: id,
      templateId: id,
      weekday: z.number().int().min(1).max(7),
      partnerId: id.nullable(),
      effectiveFrom: localDate,
      reason,
    })
    .strict(),
  [IPC_CHANNELS.createEmployee]: employeeInput,
  [IPC_CHANNELS.updateEmployee]: employeeInput.extend({ id }).strict(),
  [IPC_CHANNELS.deleteEmployee]: z.object({ employeeId: id, reason }).strict(),
  [IPC_CHANNELS.listShiftTemplates]: z.unknown(),
  [IPC_CHANNELS.createShiftTemplate]: templateInput,
  [IPC_CHANNELS.updateShiftTemplate]: templateInput.extend({ id }).strict(),
  [IPC_CHANNELS.createShiftAssignment]: z
    .object({ employeeId: id, templateId: id, validFrom: localDate, validTo: optionalDate, reason })
    .strict(),
  [IPC_CHANNELS.createWeeklyRest]: z
    .object({
      employeeId: id,
      weekday: z.number().int().min(1).max(7),
      validFrom: localDate,
      validTo: optionalDate,
      reason,
    })
    .strict(),
  [IPC_CHANNELS.createTeammatePair]: z
    .object({ employeeA: id, employeeB: id, validFrom: localDate, validTo: optionalDate, reason })
    .strict(),
  [IPC_CHANNELS.setScheduleOverride]: z
    .object({
      employeeId: id,
      date: localDate,
      kind: z.enum(['shift', 'rest', 'work_default', 'cancel_coverage']),
      templateId: id.nullish(),
      reason,
    })
    .strict(),
  [IPC_CHANNELS.createLeave]: z
    .object({
      employeeId: id,
      dateFrom: localDate,
      dateTo: localDate,
      kind: z.enum(['leave', 'permission']),
      note: z.string().max(500).nullish(),
      reason,
    })
    .strict(),
  [IPC_CHANNELS.getScheduleCalendar]: z
    .object({ employeeId: id, month: z.string().regex(/^\d{4}-\d{2}$/) })
    .strict(),
  [IPC_CHANNELS.previewAttendanceImport]: z
    .object({
      filename: z.string().trim().min(1).max(255),
      dataBase64: z.string().min(1).max(14_000_000),
      deviceSerial: z.string().trim().max(100).optional(),
    })
    .strict(),
  [IPC_CHANNELS.commitAttendanceImport]: z
    .object({
      filename: z.string().trim().min(1).max(255),
      dataBase64: z.string().min(1).max(14_000_000),
      deviceSerial: z.string().trim().max(100).optional(),
      coverageFrom: localDateTime,
      coverageTo: localDateTime,
      coverageConfirmed: z.literal(true),
    })
    .strict(),
  [IPC_CHANNELS.listQuarantinedPunches]: z.unknown(),
  [IPC_CHANNELS.resolveQuarantinedPunch]: z
    .object({ quarantineId: id, employeeId: id, reason })
    .strict(),
  [IPC_CHANNELS.getAttendanceMonth]: z
    .object({ employeeId: id, month: z.string().regex(/^\d{4}-\d{2}$/) })
    .strict(),
  [IPC_CHANNELS.setPunchCorrection]: z
    .object({
      employeeId: id,
      shiftDate: localDate,
      field: z.enum(['in', 'out']),
      newTimeLocal: localDateTime.nullable(),
      reason,
    })
    .strict(),
  [IPC_CHANNELS.listPayrollPolicies]: z.unknown(),
  [IPC_CHANNELS.createPayrollPolicy]: z
    .object({ name: z.string().trim().min(1).max(100), config: payrollConfig, reason })
    .strict(),
  [IPC_CHANNELS.previewPayroll]: z
    .object({
      employeeId: id,
      month: z.string().regex(/^\d{4}-\d{2}$/),
      policyId: id,
      lateRoundingByDate: z.record(localDate, z.enum(['exact', 'hour_up'])).optional(),
    })
    .strict(),
  [IPC_CHANNELS.approvePayroll]: z
    .object({
      employeeId: id,
      month: z.string().regex(/^\d{4}-\d{2}$/),
      policyId: id,
      lateRoundingByDate: z.record(localDate, z.enum(['exact', 'hour_up'])).optional(),
      reason,
    })
    .strict(),
  [IPC_CHANNELS.listPayrollRuns]: z
    .object({ employeeId: id, month: z.string().regex(/^\d{4}-\d{2}$/) })
    .strict(),
  [IPC_CHANNELS.voidPayrollRun]: z.object({ runId: id, reason }).strict(),
} satisfies Record<IpcChannel, z.ZodType>;

export interface IpcError {
  code: string;
  messageKey: string;
  details?: readonly string[];
  lockedUntil?: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

export interface SessionDto {
  id: number;
  username: string;
  role: 'admin' | 'user';
  canImport: boolean;
  active: boolean;
  hasPhoto: boolean;
}

export interface AuditDto {
  id: number;
  ts: string;
  actorUserId: number | null;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
}

export interface BackupInfoDto {
  path: string;
  createdAt: string;
  schemaVersion: number;
  counts: Readonly<Record<string, number>>;
}

export interface EmployeeDto {
  id: number;
  fullName: string;
  deviceUserId: string;
  hasPhoto: boolean;
  hireDate: string | null;
  active: boolean;
  monthlySalaryMinor?: number | null;
  wageBasisDays?: number;
}

export interface EmployeePhotoDto {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  dataBase64: string;
}

export interface EmployeeScheduleDto {
  templateId: number | null;
  weekday: number | null;
  partnerId: number | null;
}

export interface ShiftTemplateDto {
  id: number;
  name: string;
  active: boolean;
  startMin: number;
  endMin: number;
  inFromMin: number;
  inToMin: number;
  outFromMin: number;
  outToMin: number;
}

export interface CalendarDayDto {
  date: string;
  kind: 'SHIFT' | 'COVERAGE' | 'REST' | 'COVERAGE_NEEDED' | 'NO_SCHEDULE';
  source: string;
  templateName?: string;
  partnerId?: number;
  leaveKind?: 'leave' | 'permission';
}

export interface ImportPreviewDto {
  filename: string;
  format: string;
  verification: 'SYNTHETIC' | 'VERIFIED_REAL_FIXTURE';
  rowsTotal: number;
  rowsValid: number;
  rowsMalformed: number;
  predictedNew: number;
  predictedDuplicate: number;
  predictedQuarantined: number;
  minLocal?: string;
  maxLocal?: string;
  sample: readonly {
    deviceUserId: string;
    punchedAtLocal: string;
    rawLine: string;
    lineNo: number;
  }[];
  malformed: readonly { lineNo: number; rawLine: string; reason: string }[];
}

export interface ImportCommitSummaryDto {
  batchId: number;
  rowsTotal: number;
  rowsNew: number;
  rowsDuplicate: number;
  rowsQuarantined: number;
  rowsMalformed: number;
}

export interface QuarantinedPunchDto {
  id: number;
  deviceUserId: string;
  punchedAtLocal: string;
}

export interface AttendanceDayDto {
  date: string;
  scheduleKind: string;
  templateName?: string;
  status: string;
  punchIn?: string;
  punchOut?: string;
  hours: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  scheduledMinutes: number | null;
  flags: readonly string[];
}

export interface AttendanceMonthDto {
  employee: { id: number; fullName: string; deviceUserId: string };
  month: string;
  days: readonly AttendanceDayDto[];
  summary: {
    totalLateMinutes: number;
    statusCounts: Readonly<Record<string, number>>;
    missingPunchDates: readonly string[];
    reviewDates: readonly string[];
  };
}

export type PayrollPolicyConfigDto = z.infer<typeof payrollConfig>;

export interface PayrollPolicyDto {
  id: number;
  name: string;
  version: number;
  config: PayrollPolicyConfigDto;
  createdAt: string;
}

export interface PayrollDateResultDto {
  date: string;
  status: string;
  actualLateMinutes: number;
  billableLateMinutes: number;
  billableUnits: number;
  rule: string;
  amountBeforeCapMinor: number;
  amountMinor: number;
  capApplied: boolean;
}

export interface PayrollResultDto {
  monthlySalaryMinor: number;
  dailyWageMinor: number;
  totalLateMinutes: number;
  latenessDeductionMinor: number;
  absenceDays: number;
  absenceDeductionMinor: number;
  otherApprovedItemsMinor: number;
  totalDeductionsMinor: number;
  netPayMinor: number;
  warnings: readonly string[];
  dates: readonly PayrollDateResultDto[];
}

export interface PayrollPreviewDto {
  employee: { id: number; fullName: string; deviceUserId: string };
  month: string;
  policy: PayrollPolicyDto;
  input: unknown;
  result: PayrollResultDto;
}

export interface PayrollRunDto {
  id: number;
  employeeId: number;
  month: string;
  policyId: number;
  policySnapshot: unknown;
  inputsSnapshot: unknown;
  result: PayrollResultDto;
  status: 'approved' | 'void';
  approvedBy: number;
  approvedAt: string;
  voidReason: string | null;
}

export interface DawamDesktopApi {
  app: {
    bootstrapState(): Promise<IpcResult<{ needsSetup: boolean }>>;
  };
  auth: {
    createFirstAdmin(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createFirstAdmin]>,
    ): Promise<IpcResult<SessionDto>>;
    login(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.login]>,
    ): Promise<IpcResult<SessionDto>>;
    logout(): Promise<IpcResult<true>>;
    currentSession(): Promise<IpcResult<SessionDto | null>>;
  };
  users: {
    create(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createUser]>,
    ): Promise<IpcResult<SessionDto>>;
    list(): Promise<IpcResult<readonly SessionDto[]>>;
    setRole(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.setUserRole]>,
    ): Promise<IpcResult<SessionDto>>;
    setCanImport(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.setUserCanImport]>,
    ): Promise<IpcResult<SessionDto>>;
    setActive(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.setUserActive]>,
    ): Promise<IpcResult<SessionDto>>;
    resetPassword(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.resetUserPassword]>,
    ): Promise<IpcResult<SessionDto>>;
    getPhoto(input: { userId: number }): Promise<IpcResult<EmployeePhotoDto | null>>;
    updateOwnPhoto(input: z.infer<typeof photo>): Promise<IpcResult<SessionDto>>;
  };
  settings: {
    getLanguage(): Promise<IpcResult<'ar' | 'en'>>;
    setLanguage(language: 'ar' | 'en'): Promise<IpcResult<'ar' | 'en'>>;
    getIdleLockMinutes(): Promise<IpcResult<number>>;
    setIdleLockMinutes(minutes: 0 | 5 | 15 | 30 | 60): Promise<IpcResult<number>>;
  };
  audit: {
    verify(): Promise<IpcResult<{ valid: boolean; brokenAtId?: number }>>;
    list(input: {
      entity?: string;
      action?: string;
      limit: number;
    }): Promise<IpcResult<readonly AuditDto[]>>;
  };
  backup: {
    chooseFolder(): Promise<IpcResult<string | null>>;
    chooseFile(): Promise<IpcResult<string | null>>;
    create(input: { directory: string; password: string }): Promise<IpcResult<BackupInfoDto>>;
    stageRestore(input: {
      path: string;
      password: string;
    }): Promise<IpcResult<{ restartRequired: true; safetyBackupPath: string }>>;
  };
  imports: {
    preview(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.previewAttendanceImport]>,
    ): Promise<IpcResult<ImportPreviewDto>>;
    commit(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.commitAttendanceImport]>,
    ): Promise<IpcResult<ImportCommitSummaryDto>>;
    listQuarantined(): Promise<IpcResult<readonly QuarantinedPunchDto[]>>;
    resolveQuarantined(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.resolveQuarantinedPunch]>,
    ): Promise<IpcResult<true>>;
  };
  attendance: {
    month(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.getAttendanceMonth]>,
    ): Promise<IpcResult<AttendanceMonthDto>>;
    correct(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.setPunchCorrection]>,
    ): Promise<IpcResult<true>>;
  };
  payroll: {
    listPolicies(): Promise<IpcResult<readonly PayrollPolicyDto[]>>;
    createPolicy(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createPayrollPolicy]>,
    ): Promise<IpcResult<PayrollPolicyDto>>;
    preview(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.previewPayroll]>,
    ): Promise<IpcResult<PayrollPreviewDto>>;
    approve(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.approvePayroll]>,
    ): Promise<IpcResult<PayrollRunDto>>;
    listRuns(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.listPayrollRuns]>,
    ): Promise<IpcResult<readonly PayrollRunDto[]>>;
    voidRun(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.voidPayrollRun]>,
    ): Promise<IpcResult<PayrollRunDto>>;
  };
  workforce: {
    listEmployees(): Promise<IpcResult<readonly EmployeeDto[]>>;
    getEmployeePhoto(input: { employeeId: number }): Promise<IpcResult<EmployeePhotoDto | null>>;
    getEmployeeSchedule(input: {
      employeeId: number;
      date: string;
    }): Promise<IpcResult<EmployeeScheduleDto>>;
    updateEmployeeSchedule(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.updateEmployeeSchedule]>,
    ): Promise<IpcResult<EmployeeScheduleDto>>;
    createEmployee(input: z.infer<typeof employeeInput>): Promise<IpcResult<EmployeeDto>>;
    updateEmployee(
      input: z.infer<typeof employeeInput> & { id: number },
    ): Promise<IpcResult<EmployeeDto>>;
    deleteEmployee(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.deleteEmployee]>,
    ): Promise<IpcResult<true>>;
    listTemplates(): Promise<IpcResult<readonly ShiftTemplateDto[]>>;
    createTemplate(input: z.infer<typeof templateInput>): Promise<IpcResult<ShiftTemplateDto>>;
    updateTemplate(
      input: z.infer<typeof templateInput> & { id: number },
    ): Promise<IpcResult<ShiftTemplateDto>>;
    createAssignment(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createShiftAssignment]>,
    ): Promise<IpcResult<unknown>>;
    createRest(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createWeeklyRest]>,
    ): Promise<IpcResult<unknown>>;
    createPair(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createTeammatePair]>,
    ): Promise<IpcResult<unknown>>;
    setOverride(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.setScheduleOverride]>,
    ): Promise<IpcResult<unknown>>;
    createLeave(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.createLeave]>,
    ): Promise<IpcResult<unknown>>;
    calendar(
      input: z.infer<(typeof ipcSchemas)[typeof IPC_CHANNELS.getScheduleCalendar]>,
    ): Promise<IpcResult<readonly CalendarDayDto[]>>;
  };
  platform: string;
}
