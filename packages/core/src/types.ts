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
  /** null keeps checkout open until the next IN window or the overtime cap. */
  outToMin: number | null;
  lateGraceMin?: number;
  checkoutOpenBeforeEndMin?: number;
  otCapMin?: number;
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

export type MatchReviewFlag = 'OUTSIDE_WINDOW' | 'OUT_BEFORE_IN' | 'SHORT_STAY' | DstFlag;

export interface MatchedShift {
  instance: ShiftInstance;
  punchIn?: MatchedPunch;
  punchOut?: MatchedPunch;
  hours: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  overtimeMinutes: number | null;
  reviewFlags: readonly MatchReviewFlag[];
}

export interface MatchPunchesResult {
  shifts: readonly MatchedShift[];
  usedPunchIds: readonly string[];
  reviewPunchIds: readonly string[];
  invalidPunchIds: readonly string[];
  keptPunchIds: readonly string[];
  duplicatePunchIds: readonly string[];
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
  | 'EARLY_LEAVE'
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
  totalWorkedMinutes: number;
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  overtimeDates: readonly {
    date: LocalDate;
    scheduledEnd: LocalDateTime;
    actualOut: LocalDateTime;
    minutes: number;
  }[];
  statusCounts: Readonly<Record<AttendanceStatus, number>>;
  missingPunchDates: readonly LocalDate[];
  reviewDates: readonly LocalDate[];
}

export type GraceMode = 'threshold' | 'subtract';

export interface PayrollDayInput {
  date: LocalDate;
  status: AttendanceStatus;
  lateMinutes: number;
  /** Explicit administrator decision for this date. `automatic` preserves legacy policy behavior. */
  deductionTreatment?: 'automatic' | 'none' | 'exact' | 'hour_up' | 'full_day';
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
  treatment: 'automatic' | 'none' | 'exact' | 'hour_up' | 'full_day';
  rule: PayrollPolicy['id'] | 'manual_full_day';
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
  chargedAbsenceDays: number;
  absenceDeductionMinor: number;
  otherApprovedItemsMinor: number;
  totalDeductionsMinor: number;
  netPayMinor: number;
  warnings: readonly string[];
  dates: readonly PayrollDateResult[];
}

export type PayrollV2LateMethod =
  'none' | 'minutes' | 'hours' | 'full_day_any' | 'full_day_threshold' | 'custom_amount';

export type PayrollV2OvertimeMethod = 'none' | 'fixed_per_hour' | 'extra_days' | 'custom_amount';

export interface PayrollV2LateRule {
  method: PayrollV2LateMethod;
  hourlyAmountMinor: number;
  hourThresholdMinutes: number;
  shortLatenessAmountMinor: number;
  fullDayThresholdMinutes: number;
  graceMinutes: number;
  /** null removes the cap; otherwise defaults to the rounded daily wage. */
  capPerDayMinor: number | null;
}

export interface PayrollV2OvertimeRule {
  method: PayrollV2OvertimeMethod;
  amountPerHourMinor: number;
  minimumMinutes: number;
  rounding: 'exact' | 'down_30' | 'down_60';
  hoursPerExtraDay: number;
}

export interface PayrollV2DayInput {
  date: LocalDate;
  status: AttendanceStatus;
  lateMinutes: number;
  overtimeMinutes: number;
  scheduledMinutes?: number;
  included?: boolean;
  lateOverride?: {
    method: PayrollV2LateMethod;
    customAmountMinor?: number;
    reason?: string;
  };
  overtimeOverride?: {
    method: PayrollV2OvertimeMethod;
    customAmountMinor?: number;
    reason?: string;
  };
  edited?: boolean;
  editReason?: string | null;
}

export interface PayrollV2Input {
  monthlySalaryMinor: number;
  wageBasisDays: number;
  days: readonly PayrollV2DayInput[];
  lateRule: PayrollV2LateRule;
  overtimeRule: PayrollV2OvertimeRule;
  absenceMultiplier: { numerator: number; denominator: number };
  otherApprovedDeductionsMinor?: number;
}

export interface PayrollV2DateResult {
  date: LocalDate;
  status: AttendanceStatus;
  lateMinutes: number;
  overtimeMinutes: number;
  countedOvertimeMinutes: number;
  included: boolean;
  method: PayrollV2LateMethod;
  overtimeMethod: PayrollV2OvertimeMethod;
  deductionMinor: number;
  bonusMinor: number;
  absenceMinor: number;
  edited: boolean;
  reason: string | null;
}

export interface PayrollV2Result {
  monthlySalaryMinor: number;
  dailyWageMinor: number;
  presentDays: number;
  absenceDays: number;
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  countedOvertimeMinutes: number;
  latenessDeductionMinor: number;
  absenceDeductionMinor: number;
  overtimeBonusMinor: number;
  otherApprovedDeductionsMinor: number;
  finalSalaryMinor: number;
  warnings: readonly string[];
  dates: readonly PayrollV2DateResult[];
}
