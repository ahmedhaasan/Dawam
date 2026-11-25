import type { AttendanceResult, AttendanceStatus, MonthSummary } from './types.js';

const statuses: readonly AttendanceStatus[] = [
  'REST',
  'LEAVE',
  'PERMISSION',
  'PRESENT',
  'EARLY_LEAVE',
  'MISSING_IN',
  'MISSING_OUT',
  'ABSENT',
  'PENDING_IMPORT',
  'NOT_CLOSED',
  'COVERAGE_NEEDED',
  'NO_SCHEDULE',
  'REVIEW',
];

export const summarizeMonth = (days: readonly AttendanceResult[]): MonthSummary => {
  const statusCounts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<
    AttendanceStatus,
    number
  >;
  let totalLateMinutes = 0;
  let totalWorkedMinutes = 0;
  let totalOvertimeMinutes = 0;
  const overtimeDates: MonthSummary['overtimeDates'][number][] = [];
  const missingPunchDates: string[] = [];
  const reviewDates: string[] = [];

  for (const day of days) {
    statusCounts[day.status] += 1;
    totalWorkedMinutes += Math.max(0, Math.round((day.matched?.hours ?? 0) * 60));
    totalLateMinutes += day.matched?.lateMinutes ?? 0;
    const overtimeMinutes = day.matched?.overtimeMinutes ?? 0;
    totalOvertimeMinutes += overtimeMinutes;
    if (overtimeMinutes > 0 && day.matched?.punchOut) {
      overtimeDates.push({
        date: day.date,
        scheduledEnd: day.matched.instance.window.end.raw,
        actualOut: day.matched.punchOut.local,
        minutes: overtimeMinutes,
      });
    }
    if (day.status === 'MISSING_IN' || day.status === 'MISSING_OUT') {
      missingPunchDates.push(day.date);
    }
    if (day.status === 'REVIEW' || day.flags.length > 0) reviewDates.push(day.date);
  }

  return {
    totalWorkedMinutes,
    totalLateMinutes,
    totalOvertimeMinutes,
    overtimeDates,
    statusCounts,
    missingPunchDates,
    reviewDates,
  };
};
