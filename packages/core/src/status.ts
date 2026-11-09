import { isShiftCovered } from './coverage.js';
import { parseLocalDateTime } from './time.js';
import type {
  AttendanceResult,
  ImportCoverageInterval,
  MatchedShift,
  ResolvedSchedule,
  Result,
} from './types.js';

export interface StatusInput {
  schedule: ResolvedSchedule;
  matched?: MatchedShift;
  coverage: readonly ImportCoverageInterval[];
  nowLocal: string;
  hasOutsideWindowPunches?: boolean;
}

export interface StatusError {
  code: 'INVALID_NOW' | 'MATCH_SCHEDULE_MISMATCH';
  value?: string;
}

export const computeAttendanceStatus = (
  input: StatusInput,
): Result<AttendanceResult, StatusError> => {
  const baseFlags = [
    ...(input.matched?.reviewFlags ?? []),
    ...(input.hasOutsideWindowPunches ? (['OUTSIDE_WINDOW'] as const) : []),
  ];
  const flags = [...new Set(baseFlags)];
  const base = {
    employeeId: input.schedule.employeeId,
    date: input.schedule.date,
    flags,
    ...(input.matched ? { matched: input.matched } : {}),
  };

  if (input.schedule.kind === 'REST') {
    return { ok: true, value: { ...base, status: 'REST' } };
  }
  if (input.schedule.kind === 'COVERAGE_NEEDED') {
    return { ok: true, value: { ...base, status: 'COVERAGE_NEEDED' } };
  }
  if (input.schedule.kind === 'NO_SCHEDULE') {
    return { ok: true, value: { ...base, status: 'NO_SCHEDULE' } };
  }
  if (input.schedule.leaveKind === 'leave') {
    return { ok: true, value: { ...base, status: 'LEAVE' } };
  }
  if (input.schedule.leaveKind === 'permission') {
    return { ok: true, value: { ...base, status: 'PERMISSION' } };
  }
  if (!input.matched) {
    return { ok: false, error: { code: 'MATCH_SCHEDULE_MISMATCH' } };
  }
  if (
    input.matched.instance.employeeId !== input.schedule.employeeId ||
    input.matched.instance.date !== input.schedule.date
  ) {
    return { ok: false, error: { code: 'MATCH_SCHEDULE_MISMATCH' } };
  }

  const now = parseLocalDateTime(input.nowLocal);
  if (!now.ok) {
    return { ok: false, error: { code: 'INVALID_NOW', value: input.nowLocal } };
  }
  if (now.value.epochMs < input.matched.instance.window.outTo.epochMs) {
    return { ok: true, value: { ...base, status: 'NOT_CLOSED' } };
  }

  const complete = Boolean(input.matched.punchIn && input.matched.punchOut);
  if (!isShiftCovered(input.matched.instance, input.coverage)) {
    return {
      ok: true,
      value: { ...base, status: complete ? 'PRESENT' : 'PENDING_IMPORT' },
    };
  }
  if (complete) return { ok: true, value: { ...base, status: 'PRESENT' } };
  if (input.matched.punchIn) {
    return { ok: true, value: { ...base, status: 'MISSING_OUT' } };
  }
  if (input.matched.punchOut) {
    return { ok: true, value: { ...base, status: 'MISSING_IN' } };
  }
  return { ok: true, value: { ...base, status: 'ABSENT' } };
};
