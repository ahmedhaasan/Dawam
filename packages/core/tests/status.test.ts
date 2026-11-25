import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeAttendanceStatus, matchPunches, summarizeMonth } from '../src/index.js';
import type {
  AttendanceResult,
  ImportCoverageInterval,
  MatchedShift,
  RawPunch,
  ResolvedSchedule,
} from '../src/index.js';
import { instanceFor, shiftSchedule } from './helpers.js';

const fullCoverage: ImportCoverageInterval[] = [
  {
    fromLocal: '2026-11-09 09:40:00',
    toLocal: '2026-11-09 23:00:00',
    confirmed: true,
  },
];

const matchedWith = (locals: readonly string[]): MatchedShift => {
  const punches: RawPunch[] = locals.map((local, index) => ({
    id: `P${index}`,
    deviceUserId: 'E1',
    punchedAtLocal: local,
  }));
  return matchPunches([instanceFor()], punches).shifts[0]!;
};

const status = (
  matched: MatchedShift,
  coverage: readonly ImportCoverageInterval[] = fullCoverage,
  nowLocal = '2026-11-10 00:00:00',
) =>
  computeAttendanceStatus({
    schedule: shiftSchedule(),
    matched,
    coverage,
    nowLocal,
  });

describe('attendance status engine', () => {
  it('evaluates non-working schedule statuses first', () => {
    const rest: ResolvedSchedule = {
      employeeId: 'E1',
      date: '2026-11-09',
      kind: 'REST',
      source: 'weekly_rest',
    };
    const needed: ResolvedSchedule = {
      employeeId: 'E1',
      date: '2026-11-09',
      kind: 'COVERAGE_NEEDED',
      source: 'coverage_needed',
    };
    const none: ResolvedSchedule = {
      employeeId: 'E1',
      date: '2026-11-09',
      kind: 'NO_SCHEDULE',
      source: 'none',
    };
    expect(
      computeAttendanceStatus({ schedule: rest, coverage: [], nowLocal: 'bad' }),
    ).toMatchObject({ ok: true, value: { status: 'REST' } });
    expect(
      computeAttendanceStatus({ schedule: needed, coverage: [], nowLocal: 'bad' }),
    ).toMatchObject({ ok: true, value: { status: 'COVERAGE_NEEDED' } });
    expect(
      computeAttendanceStatus({ schedule: none, coverage: [], nowLocal: 'bad' }),
    ).toMatchObject({ ok: true, value: { status: 'NO_SCHEDULE' } });
  });

  it('shows approved leave and permission while retaining matched data', () => {
    const matched = matchedWith(['2026-11-09 10:00:00', '2026-11-09 22:00:00']);
    for (const [leaveKind, expected] of [
      ['leave', 'LEAVE'],
      ['permission', 'PERMISSION'],
    ] as const) {
      const result = computeAttendanceStatus({
        schedule: { ...shiftSchedule(), leaveKind },
        matched,
        coverage: [],
        nowLocal: 'bad',
      });
      expect(result).toMatchObject({ ok: true, value: { status: expected, matched } });
    }
  });

  it('does not close a shift before its OUT window ends', () => {
    expect(
      status(matchedWith(['2026-11-09 10:00:00']), fullCoverage, '2026-11-09 22:30:00'),
    ).toMatchObject({ ok: true, value: { status: 'NOT_CLOSED' } });
  });

  it('marks a complete accepted pair present even while its OUT zone remains open', () => {
    expect(
      status(
        matchedWith(['2026-11-09 10:00:00', '2026-11-09 21:52:00']),
        fullCoverage,
        '2026-11-09 22:30:00',
      ),
    ).toMatchObject({
      ok: true,
      value: {
        status: 'PRESENT',
        matched: { earlyLeaveMinutes: 8 },
      },
    });
  });

  it('never infers absence without confirmed full coverage', () => {
    const empty = matchedWith([]);
    expect(status(empty, [])).toMatchObject({
      ok: true,
      value: { status: 'PENDING_IMPORT' },
    });
    expect(
      status(empty, [
        {
          fromLocal: '2026-11-09 10:00:00',
          toLocal: '2026-11-09 22:00:00',
          confirmed: true,
        },
      ]),
    ).toMatchObject({ ok: true, value: { status: 'PENDING_IMPORT' } });
    expect(status(empty, fullCoverage)).toMatchObject({
      ok: true,
      value: { status: 'ABSENT' },
    });
  });

  it('accepts a complete pair even when the import coverage is incomplete', () => {
    const complete = matchedWith(['2026-11-09 10:00:00', '2026-11-09 22:00:00']);
    expect(status(complete, [])).toMatchObject({
      ok: true,
      value: { status: 'PRESENT' },
    });
  });

  it('distinguishes missing IN and missing OUT after confirmed coverage', () => {
    expect(status(matchedWith(['2026-11-09 10:00:00']))).toMatchObject({
      ok: true,
      value: { status: 'MISSING_OUT' },
    });
    expect(status(matchedWith(['2026-11-09 22:00:00']))).toMatchObject({
      ok: true,
      value: { status: 'MISSING_IN' },
    });
  });

  it('adds REVIEW without discarding the primary status', () => {
    const result = computeAttendanceStatus({
      schedule: shiftSchedule(),
      matched: matchedWith([]),
      coverage: fullCoverage,
      nowLocal: '2026-11-10 00:00:00',
      hasOutsideWindowPunches: true,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'ABSENT', flags: ['OUTSIDE_WINDOW'] },
    });
  });

  it('returns typed errors for bad clocks and mismatched results', () => {
    expect(status(matchedWith([]), fullCoverage, 'not-a-clock')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_NOW' },
    });
    const wrong = matchedWith([]);
    wrong.instance.employeeId = 'OTHER';
    expect(status(wrong)).toMatchObject({
      ok: false,
      error: { code: 'MATCH_SCHEDULE_MISMATCH' },
    });
  });

  it('summarizes actual late minutes, missing punches, and review dates', () => {
    const present = status(matchedWith(['2026-11-09 10:20:00', '2026-11-09 22:00:00']));
    const missing = status(matchedWith(['2026-11-09 10:00:00']));
    expect(present.ok && missing.ok).toBe(true);
    const days: AttendanceResult[] = [
      ...(present.ok ? [present.value] : []),
      ...(missing.ok
        ? [{ ...missing.value, date: '2026-11-10', flags: ['OUTSIDE_WINDOW'] as const }]
        : []),
    ];
    const summary = summarizeMonth(days);
    expect(summary.totalLateMinutes).toBe(20);
    expect(summary.totalWorkedMinutes).toBe(700);
    expect(summary.totalOvertimeMinutes).toBe(0);
    expect(summary.statusCounts.PRESENT).toBe(1);
    expect(summary.statusCounts.MISSING_OUT).toBe(1);
    expect(summary.missingPunchDates).toEqual(['2026-11-10']);
    expect(summary.reviewDates).toEqual(['2026-11-10']);
  });

  it('summarizes overtime dates and equals the sum of daily overtime', () => {
    const matched = matchedWith(['2026-11-09 10:00:00', '2026-11-09 22:30:00']);
    const detailed = summarizeMonth([
      {
        employeeId: 'E1',
        date: '2026-11-09',
        status: 'PRESENT',
        matched,
        flags: [],
      },
    ]);
    expect(detailed.overtimeDates).toEqual([
      {
        date: '2026-11-09',
        scheduledEnd: '2026-11-09 22:00:00',
        actualOut: '2026-11-09 22:30:00',
        minutes: 30,
      },
    ]);

    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 480 }), { minLength: 1, maxLength: 31 }),
        (values) => {
          const days: AttendanceResult[] = values.map((overtimeMinutes, index) => {
            const date = `2026-11-${String(index + 1).padStart(2, '0')}`;
            return {
              employeeId: 'E1',
              date,
              status: 'PRESENT' as const,
              matched: {
                instance: instanceFor(date),
                hours: 12,
                lateMinutes: 0,
                earlyLeaveMinutes: 0,
                overtimeMinutes,
                reviewFlags: [],
              },
              flags: [],
            };
          });
          expect(summarizeMonth(days).totalOvertimeMinutes).toBe(
            days.reduce((sum, day) => sum + (day.matched?.overtimeMinutes ?? 0), 0),
          );
        },
      ),
    );
  });

  it('always sums month lateness from its individual dates', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 600 }), { maxLength: 31 }), (lateMinutes) => {
        const days: AttendanceResult[] = lateMinutes.map((minutes, index) => ({
          employeeId: 'E1',
          date: `2026-11-${String(index + 1).padStart(2, '0')}`,
          status: 'PRESENT',
          flags: [],
          matched: {
            instance: instanceFor(),
            hours: 12,
            lateMinutes: minutes,
            earlyLeaveMinutes: 0,
            overtimeMinutes: 0,
            reviewFlags: [],
          },
        }));
        expect(summarizeMonth(days).totalLateMinutes).toBe(
          lateMinutes.reduce((total, minutes) => total + minutes, 0),
        );
      }),
    );
  });
});
