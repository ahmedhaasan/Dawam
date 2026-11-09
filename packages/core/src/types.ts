export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type LocalDate = string;
export type LocalDateTime = string;
export type EmployeeId = string;
export type ShiftTemplateId = string;

export interface ShiftTemplate {
  id: ShiftTemplateId;
  name: string;
  startMin: number;
  endMin: number;
  inFromMin: number;
  inToMin: number;
  outFromMin: number;
  outToMin: number;
}

export interface ShiftAssignment {
  employeeId: EmployeeId;
  templateId: ShiftTemplateId;
  validFrom: LocalDate;
  validTo?: LocalDate;
}

export interface WeeklyRestRule {
  employeeId: EmployeeId;
  /** ISO weekday: Monday=1, Sunday=7. */
  weekday: number;
  validFrom: LocalDate;
  validTo?: LocalDate;
}

export type ScheduleOverrideKind = 'shift' | 'rest' | 'work_default' | 'cancel_coverage';

export interface ScheduleOverride {
  employeeId: EmployeeId;
  date: LocalDate;
  kind: ScheduleOverrideKind;
  templateId?: ShiftTemplateId;
  reason: string;
}

export interface TeammatePair {
  employeeA: EmployeeId;
  employeeB: EmployeeId;
  validFrom: LocalDate;
  validTo?: LocalDate;
}

export type LeaveKind = 'leave' | 'permission';

export interface ApprovedLeave {
  employeeId: EmployeeId;
  dateFrom: LocalDate;
  dateTo: LocalDate;
  kind: LeaveKind;
}

export interface ScheduleContext {
  templates: readonly ShiftTemplate[];
  assignments: readonly ShiftAssignment[];
  weeklyRest: readonly WeeklyRestRule[];
  overrides: readonly ScheduleOverride[];
  pairs: readonly TeammatePair[];
  leaves: readonly ApprovedLeave[];
}

export type ScheduleKind = 'SHIFT' | 'COVERAGE' | 'REST' | 'COVERAGE_NEEDED' | 'NO_SCHEDULE';

export interface ResolvedSchedule {
  employeeId: EmployeeId;
  date: LocalDate;
  kind: ScheduleKind;
  template?: ShiftTemplate;
  source: 'override' | 'assignment' | 'weekly_rest' | 'coverage' | 'coverage_needed' | 'none';
  leaveKind?: LeaveKind;
  partnerId?: EmployeeId;
}

export type DstFlag = 'AMBIGUOUS_LOCAL_TIME' | 'NONEXISTENT_LOCAL_TIME';

export interface ZonedLocalTime {
  raw: LocalDateTime;
  epochMs: number;
  offsetMinutes: number;
  flags: readonly DstFlag[];
}

export interface ShiftWindow {
  start: ZonedLocalTime;
  end: ZonedLocalTime;
  inFrom: ZonedLocalTime;
  inTo: ZonedLocalTime;
  outFrom: ZonedLocalTime;
  outTo: ZonedLocalTime;
}

export interface ShiftInstance {
  employeeId: EmployeeId;
  date: LocalDate;
  scheduleKind: 'SHIFT' | 'COVERAGE';
  template: ShiftTemplate;
  window: ShiftWindow;
  leaveKind?: LeaveKind;
}

export interface RawPunch {
  id: string;
  deviceUserId: string;
  punchedAtLocal: LocalDateTime;
  deviceStatus?: string;
  verifyMode?: string;
}

export interface PunchCorrection {
  employeeId: EmployeeId;
  shiftDate: LocalDate;
  field: 'in' | 'out';
  /** null explicitly removes the field. */
  newTimeLocal: LocalDateTime | null;
  reason: string;
}

export interface MatchedPunch {
  local: LocalDateTime;
  epochMs: number;
  source: 'raw' | 'manual';
  rawPunchId?: string;
  flags: readonly DstFlag[];
}

export type MatchReviewFlag = 'OUTSIDE_WINDOW' | 'OUT_BEFORE_IN' | DstFlag;

export interface MatchedShift {
  instance: ShiftInstance;
  punchIn?: MatchedPunch;
  punchOut?: MatchedPunch;
  hours: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  reviewFlags: readonly MatchReviewFlag[];
}

export interface MatchPunchesResult {
  shifts: readonly MatchedShift[];
  usedPunchIds: readonly string[];
  reviewPunchIds: readonly string[];
  invalidPunchIds: readonly string[];
}

export interface ImportCoverageInterval {
  fromLocal: LocalDateTime;
  toLocal: LocalDateTime;
  confirmed: boolean;
}

export type AttendanceStatus =
  | 'REST'
  | 'LEAVE'
  | 'PERMISSION'
  | 'PRESENT'
  | 'MISSING_IN'
  | 'MISSING_OUT'
  | 'ABSENT'
  | 'PENDING_IMPORT'
  | 'NOT_CLOSED'
  | 'COVERAGE_NEEDED'
  | 'NO_SCHEDULE'
  | 'REVIEW';

export interface AttendanceResult {
  employeeId: EmployeeId;
  date: LocalDate;
  status: AttendanceStatus;
  matched?: MatchedShift;
  flags: readonly MatchReviewFlag[];
}

export interface MonthSummary {
  totalLateMinutes: number;
  statusCounts: Readonly<Record<AttendanceStatus, number>>;
  missingPunchDates: readonly LocalDate[];
  reviewDates: readonly LocalDate[];
}

export type GraceMode = 'threshold' | 'subtract';

export interface PayrollDayInput {
  date: LocalDate;
  status: AttendanceStatus;
  lateMinutes: number;
  /** Optional administrator choice for this date when using a fixed hourly amount. */
  lateRounding?: 'exact' | 'hour_up';
  /** Required when the policy uses the scheduled shift as its hourly basis. */
  scheduledMinutes?: number;
}

export interface CustomTier {
  fromMin: number;
  toMin: number | null;
  amountMinor?: number;
  fractionOfDaily?: {
    numerator: number;
    denominator: number;
  };
}

export type PayrollPolicy =
  | { id: 'none' }
  | { id: 'fixed_hourly_amount'; amountMinor: number }
  | { id: 'fixed_hourly_rounded_up'; amountMinor: number }
  | { id: 'hourly_proportional' }
  | { id: 'hourly_rounded_up' }
  | { id: 'day_per_started_hour' }
  | { id: 'day_any_lateness' }
  | { id: 'day_at_threshold'; thresholdMinutes: number }
  | { id: 'custom_tiers'; tiers: readonly CustomTier[] };

export interface PayrollOptions {
  graceMinutes?: number;
  graceMode?: GraceMode;
  /** undefined = one rounded daily wage, null = no cap. */
  capPerDateMinor?: number | null;
  hourlyBasis?: { kind: 'scheduled_shift' } | { kind: 'fixed'; minutes: number };
  absenceMultiplier?: { numerator: number; denominator: number };
  otherApprovedItemsMinor?: number;
}

export interface PayrollInput {
  monthlySalaryMinor: number;
  wageBasisDays: number;
  days: readonly PayrollDayInput[];
  policy: PayrollPolicy;
  options?: PayrollOptions;
}

export interface PayrollDateResult {
  date: LocalDate;
  status: AttendanceStatus;
  actualLateMinutes: number;
  billableLateMinutes: number;
  billableUnits: number;
  rule: PayrollPolicy['id'];
  amountBeforeCapMinor: number;
  amountMinor: number;
  capApplied: boolean;
}

export interface PayrollResult {
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
  dates: readonly PayrollDateResult[];
}
