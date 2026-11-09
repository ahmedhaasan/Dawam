import type { AttendanceResult, AttendanceStatus, MonthSummary } from './types.js';

const statuses: readonly AttendanceStatus[] = [
  'REST',
  'LEAVE',
  'PERMISSION',
  'PRESENT',
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
  const missingPunchDates: string[] = [];
  const reviewDates: string[] = [];

  for (const day of days) {
    statusCounts[day.status] += 1;
    totalLateMinutes += day.matched?.lateMinutes ?? 0;
    if (day.status === 'MISSING_IN' || day.status === 'MISSING_OUT') {
      missingPunchDates.push(day.date);
    }
    if (day.status === 'REVIEW' || day.flags.length > 0) reviewDates.push(day.date);
  }

  return {
    totalLateMinutes,
    statusCounts,
    missingPunchDates,
    reviewDates,
  };
};
