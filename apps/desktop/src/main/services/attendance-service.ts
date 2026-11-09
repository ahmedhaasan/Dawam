import {
  computeAttendanceStatus,
  createShiftInstance,
  isValidLocalDate,
  localDateTimeFromEpoch,
  matchPunches,
  parseLocalDateTime,
  resolveSchedule,
  summarizeMonth,
  type AttendanceStatus,
  type ResolvedSchedule,
  type ScheduleContext,
  type ShiftInstance,
} from '@dawam/core';
import {
  AttendanceRepository,
  AuditRepository,
  type Clock,
  type DawamDatabase,
  systemClock,
  WorkforceRepository,
} from '@dawam/db';

import type { AuthService } from './auth-service.js';
import type { ServiceResult } from './service-result.js';

export interface AttendanceDayView {
  date: string;
  scheduleKind: string;
  templateName?: string;
  status: AttendanceStatus;
  punchIn?: string;
  punchOut?: string;
  hours: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  scheduledMinutes: number | null;
  flags: readonly string[];
}

export interface AttendanceMonthView {
  employee: { id: number; fullName: string; deviceUserId: string };
  month: string;
  days: readonly AttendanceDayView[];
  summary: {
    totalLateMinutes: number;
    statusCounts: Readonly<Record<AttendanceStatus, number>>;
    missingPunchDates: readonly string[];
    reviewDates: readonly string[];
  };
}

export interface AttendanceError {
  code: string;
  messageKey: string;
  details?: readonly string[];
}

const failure = (code: string, details?: readonly string[]): AttendanceError => ({
  code,
  messageKey: `errors.attendance_${code.toLowerCase()}`,
  ...(details ? { details } : {}),
});

const datesForMonth = (month: string): readonly string[] | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return Array.from(
    { length: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() },
    (_, index) => `${match[1]}-${match[2]}-${String(index + 1).padStart(2, '0')}`,
  );
};

export class AttendanceService {
  private readonly attendance: AttendanceRepository;
  private readonly workforce: WorkforceRepository;
  private readonly audit: AuditRepository;

  constructor(
    private readonly database: DawamDatabase,
    private readonly auth: AuthService,
    private readonly clock: Clock = systemClock,
  ) {
    this.attendance = new AttendanceRepository(database, clock);
    this.workforce = new WorkforceRepository(database);
    this.audit = new AuditRepository(database, clock);
  }

  private context(): ScheduleContext {
    return {
      templates: this.workforce.listTemplates().map((item) => ({
        id: String(item.id),
        name: item.name,
        startMin: item.startMin,
        endMin: item.endMin,
        inFromMin: item.inFromMin,
        inToMin: item.inToMin,
        outFromMin: item.outFromMin,
        outToMin: item.outToMin,
      })),
      assignments: this.workforce.listAssignments().map((item) => ({
        employeeId: String(item.employeeId),
        templateId: String(item.templateId),
        validFrom: item.validFrom,
        ...(item.validTo ? { validTo: item.validTo } : {}),
      })),
      weeklyRest: this.workforce.listRests().map((item) => ({
        employeeId: String(item.employeeId),
        weekday: item.weekday,
        validFrom: item.validFrom,
        ...(item.validTo ? { validTo: item.validTo } : {}),
      })),
      overrides: this.workforce.listOverrides().map((item) => ({
        employeeId: String(item.employeeId),
        date: item.date,
        kind: item.kind,
        ...(item.templateId ? { templateId: String(item.templateId) } : {}),
        reason: item.reason,
      })),
      pairs: this.workforce.listPairs().map((item) => ({
        employeeA: String(item.employeeA),
        employeeB: String(item.employeeB),
        validFrom: item.validFrom,
        ...(item.validTo ? { validTo: item.validTo } : {}),
      })),
      leaves: this.workforce.listLeaves().map((item) => ({
        employeeId: String(item.employeeId),
        dateFrom: item.dateFrom,
        dateTo: item.dateTo,
        kind: item.kind,
      })),
    };
  }

  month(employeeId: number, month: string): ServiceResult<AttendanceMonthView, AttendanceError> {
    const actor = this.auth.authorize('attendance.read');
    if (!actor.ok) return actor;
    const employee = this.workforce.findEmployee(employeeId);
    if (!employee) return { ok: false, error: failure('EMPLOYEE_NOT_FOUND') };
    const dates = datesForMonth(month);
    if (!dates) return { ok: false, error: failure('INVALID_MONTH') };
    const context = this.context();
    const schedules: ResolvedSchedule[] = [];
    const instances: ShiftInstance[] = [];
    for (const date of dates) {
      const schedule = resolveSchedule(String(employeeId), date, context);
      if (!schedule.ok) return { ok: false, error: failure('SCHEDULE', [schedule.error.code]) };
      schedules.push(schedule.value);
      const instance = createShiftInstance(schedule.value);
      if (!instance.ok) return { ok: false, error: failure('SCHEDULE', [instance.error.code]) };
      if (instance.value) instances.push(instance.value);
    }
    const punches = this.attendance.listPunchesForEmployee(employee.id, employee.deviceUserId);
    const corrections = this.attendance.listCorrections(employee.id, month);
    const matched = matchPunches(instances, punches, {
      corrections,
      deviceUserIdByEmployee: { [String(employee.id)]: employee.deviceUserId },
    });
    const coverage = this.attendance.listConfirmedCoverage();
    const nowLocal = localDateTimeFromEpoch(this.clock.now().getTime());
    const results = [];
    for (const schedule of schedules) {
      const dayMatch = matched.shifts.find((item) => item.instance.date === schedule.date);
      const status = computeAttendanceStatus({
        schedule,
        ...(dayMatch ? { matched: dayMatch } : {}),
        coverage,
        nowLocal,
      });
      if (!status.ok) return { ok: false, error: failure('STATUS', [status.error.code]) };
      results.push(status.value);
    }
    const summary = summarizeMonth(results);
    return {
      ok: true,
      value: {
        employee: {
          id: employee.id,
          fullName: employee.fullName,
          deviceUserId: employee.deviceUserId,
        },
        month,
        days: results.map((day) => {
          const schedule = schedules.find((item) => item.date === day.date)!;
          return {
            date: day.date,
            scheduleKind: schedule.kind,
            ...(schedule.template ? { templateName: schedule.template.name } : {}),
            status: day.status,
            ...(day.matched?.punchIn ? { punchIn: day.matched.punchIn.local } : {}),
            ...(day.matched?.punchOut ? { punchOut: day.matched.punchOut.local } : {}),
            hours: day.matched?.hours ?? null,
            lateMinutes: day.matched?.lateMinutes ?? null,
            earlyLeaveMinutes: day.matched?.earlyLeaveMinutes ?? null,
            scheduledMinutes: schedule.template
              ? schedule.template.endMin - schedule.template.startMin
              : null,
            flags: day.flags,
          };
        }),
        summary,
      },
    };
  }

  correct(input: {
    employeeId: number;
    shiftDate: string;
    field: 'in' | 'out';
    newTimeLocal: string | null;
    reason: string;
  }): ServiceResult<true, AttendanceError> {
    const actor = this.auth.authorize('workforce.manage');
    if (!actor.ok) return actor;
    if (!this.workforce.findEmployee(input.employeeId))
      return { ok: false, error: failure('EMPLOYEE_NOT_FOUND') };
    if (!isValidLocalDate(input.shiftDate)) return { ok: false, error: failure('INVALID_DATE') };
    if (input.newTimeLocal !== null && !parseLocalDateTime(input.newTimeLocal).ok)
      return { ok: false, error: failure('INVALID_TIME') };
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    this.database.transaction(() => {
      const correction = this.attendance.setCorrection({
        ...input,
        reason: input.reason.trim(),
        createdBy: actor.value.id,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'attendance.correction_set',
        entity: 'punch_correction',
        entityId: String(correction.id),
        after: correction,
        reason: input.reason.trim(),
      });
    });
    return { ok: true, value: true };
  }
}
