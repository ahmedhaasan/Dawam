import { describe, expect, it } from 'vitest';

import { createShiftInstance, resolveSchedule } from '../src/index.js';
import type { ScheduleContext } from '../src/index.js';
import { emptyContext, evening, morning } from './helpers.js';

const baseContext = (): ScheduleContext => ({
  ...emptyContext(),
  assignments: [
    { employeeId: 'A', templateId: 'morning', validFrom: '2026-01-01' },
    { employeeId: 'B', templateId: 'evening', validFrom: '2026-01-01' },
  ],
  pairs: [{ employeeA: 'A', employeeB: 'B', validFrom: '2026-01-01', validTo: '2026-12-31' }],
});

describe('schedule resolution', () => {
  it('uses an override shift before weekly rest and attaches approved leave', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      weeklyRest: [{ employeeId: 'A', weekday: 6, validFrom: '2026-01-01' }],
      overrides: [
        {
          employeeId: 'A',
          date: '2026-11-07',
          kind: 'shift',
          templateId: 'evening',
          reason: 'Special coverage',
        },
      ],
      leaves: [
        {
          employeeId: 'A',
          dateFrom: '2026-11-07',
          dateTo: '2026-11-07',
          kind: 'leave',
        },
      ],
    };
    const result = resolveSchedule('A', '2026-11-07', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('SHIFT');
      expect(result.value.template?.id).toBe('evening');
      expect(result.value.leaveKind).toBe('leave');
      expect(result.value.source).toBe('override');
    }
  });

  it('merges both templates when a working employee covers a resting teammate', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      weeklyRest: [{ employeeId: 'B', weekday: 6, validFrom: '2026-01-01' }],
    };
    const result = resolveSchedule('A', '2026-11-07', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('COVERAGE');
      expect(result.value.partnerId).toBe('B');
      expect(result.value.template).toMatchObject({
        startMin: morning.startMin,
        endMin: evening.endMin,
        inFromMin: morning.inFromMin,
        outToMin: evening.outToMin,
      });
    }
  });

  it('flags both employees when both are resting without recursion', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      weeklyRest: [
        { employeeId: 'A', weekday: 6, validFrom: '2026-01-01' },
        { employeeId: 'B', weekday: 6, validFrom: '2026-01-01' },
      ],
    };
    const a = resolveSchedule('A', '2026-11-07', context);
    const b = resolveSchedule('B', '2026-11-07', context);
    expect(a.ok && a.value.kind).toBe('COVERAGE_NEEDED');
    expect(b.ok && b.value.kind).toBe('COVERAGE_NEEDED');
  });

  it('lets a dated override cancel automatic coverage', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      weeklyRest: [{ employeeId: 'B', weekday: 6, validFrom: '2026-01-01' }],
      overrides: [
        {
          employeeId: 'A',
          date: '2026-11-07',
          kind: 'cancel_coverage',
          reason: 'Manager override',
        },
      ],
    };
    const result = resolveSchedule('A', '2026-11-07', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('SHIFT');
      expect(result.value.template?.id).toBe('morning');
      expect(result.value.source).toBe('override');
    }
  });

  it('honours pair validity ranges and ordinary weekly rest', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      pairs: [{ employeeA: 'A', employeeB: 'B', validFrom: '2026-12-01', validTo: '2026-12-31' }],
      weeklyRest: [{ employeeId: 'A', weekday: 6, validFrom: '2026-01-01' }],
    };
    const result = resolveSchedule('A', '2026-11-07', context);
    expect(result.ok && result.value.kind).toBe('REST');
  });

  it('keeps the resting employee at REST when only the teammate is working', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      weeklyRest: [{ employeeId: 'A', weekday: 6, validFrom: '2026-01-01' }],
    };
    const result = resolveSchedule('A', '2026-11-07', context);
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'REST', partnerId: 'B' },
    });
  });

  it('supports force-work overrides on a weekly rest date', () => {
    const context: ScheduleContext = {
      ...baseContext(),
      weeklyRest: [{ employeeId: 'A', weekday: 6, validFrom: '2026-01-01' }],
      overrides: [
        {
          employeeId: 'A',
          date: '2026-11-07',
          kind: 'work_default',
          reason: 'Required work',
        },
      ],
    };
    expect(resolveSchedule('A', '2026-11-07', context)).toMatchObject({
      ok: true,
      value: { kind: 'SHIFT', source: 'override' },
    });
  });

  it('returns NO_SCHEDULE and typed configuration errors', () => {
    const none = resolveSchedule('UNKNOWN', '2026-11-09', emptyContext());
    expect(none.ok && none.value.kind).toBe('NO_SCHEDULE');
    expect(resolveSchedule('A', 'bad-date', baseContext())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_DATE' },
    });

    const duplicate: ScheduleContext = {
      ...baseContext(),
      assignments: [
        ...baseContext().assignments,
        { employeeId: 'A', templateId: 'evening', validFrom: '2026-01-01' },
      ],
    };
    expect(resolveSchedule('A', '2026-11-09', duplicate)).toMatchObject({
      ok: false,
      error: { code: 'MULTIPLE_ASSIGNMENTS' },
    });

    const missingTemplate: ScheduleContext = {
      ...baseContext(),
      assignments: [{ employeeId: 'A', templateId: 'missing', validFrom: '2026-01-01' }],
    };
    expect(resolveSchedule('A', '2026-11-09', missingTemplate)).toMatchObject({
      ok: false,
      error: { code: 'MISSING_TEMPLATE', templateId: 'missing' },
    });

    const multiplePairs: ScheduleContext = {
      ...baseContext(),
      pairs: [...baseContext().pairs, { employeeA: 'A', employeeB: 'C', validFrom: '2026-01-01' }],
    };
    expect(resolveSchedule('A', '2026-11-09', multiplePairs)).toMatchObject({
      ok: false,
      error: { code: 'MULTIPLE_ACTIVE_PAIRS' },
    });
  });

  it('rejects incomplete overrides and pair coverage without both templates', () => {
    expect(
      resolveSchedule('A', '2026-11-09', {
        ...baseContext(),
        overrides: [
          { employeeId: 'A', date: '2026-11-09', kind: 'shift', reason: 'Missing shift' },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SHIFT_OVERRIDE' } });

    expect(
      resolveSchedule('A', '2026-11-07', {
        ...baseContext(),
        assignments: [{ employeeId: 'A', templateId: 'morning', validFrom: '2026-01-01' }],
        weeklyRest: [{ employeeId: 'B', weekday: 6, validFrom: '2026-01-01' }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'COVERAGE_TEMPLATE_MISSING' } });
  });

  it('creates instances only for scheduled work', () => {
    const shift = resolveSchedule('A', '2026-11-09', baseContext());
    expect(shift.ok).toBe(true);
    if (shift.ok) {
      const instance = createShiftInstance(shift.value);
      expect(instance.ok && instance.value).toBeTruthy();
    }

    expect(
      createShiftInstance({
        employeeId: 'A',
        date: '2026-11-09',
        kind: 'REST',
        source: 'weekly_rest',
      }),
    ).toEqual({ ok: true, value: null });
  });
});
