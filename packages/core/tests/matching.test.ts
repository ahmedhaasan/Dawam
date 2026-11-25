import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { matchPunches } from '../src/index.js';
import type { RawPunch } from '../src/index.js';
import { instanceFor } from './helpers.js';

const punch = (id: string, local: string, deviceStatus?: string): RawPunch => ({
  id,
  deviceUserId: 'E1',
  punchedAtLocal: local,
  ...(deviceStatus ? { deviceStatus } : {}),
});

describe('punch matching', () => {
  it('uses the earliest IN and last OUT while ignoring unreliable device flags', () => {
    const result = matchPunches(
      [instanceFor()],
      [
        punch('outside', '2026-11-09 08:00:00'),
        punch('in-first', '2026-11-09 09:50:00', 'out'),
        punch('in-extra', '2026-11-09 10:30:00', 'out'),
        punch('out-first', '2026-11-09 22:00:00', 'in'),
        punch('out-last', '2026-11-09 22:05:00', 'in'),
      ],
    );
    expect(result.shifts[0]?.punchIn?.rawPunchId).toBe('in-first');
    expect(result.shifts[0]?.punchOut?.rawPunchId).toBe('out-first');
    expect(result.shifts[0]?.hours).toBeCloseTo(12.1667);
    expect(result.shifts[0]?.lateMinutes).toBe(0);
    expect(result.shifts[0]?.earlyLeaveMinutes).toBe(0);
    expect(result.reviewPunchIds).toEqual(['outside']);
    expect(result.usedPunchIds).toEqual(['in-first', 'out-first']);
  });

  it('truncates seconds when calculating lateness', () => {
    const result = matchPunches(
      [instanceFor()],
      [punch('in', '2026-11-09 10:00:59'), punch('out', '2026-11-09 22:00:00')],
    );
    expect(result.shifts[0]?.lateMinutes).toBe(0);
  });

  it('keeps the first biometric scan and reports scans within 300 seconds as duplicates', () => {
    const result = matchPunches(
      [instanceFor()],
      [
        punch('scan-1', '2026-11-09 22:10:36'),
        punch('scan-2', '2026-11-09 22:10:41'),
        punch('scan-3', '2026-11-09 22:10:48'),
        punch('scan-4', '2026-11-09 22:10:54'),
        punch('scan-5', '2026-11-09 22:10:59'),
      ],
    );
    expect(result.keptPunchIds).toEqual(['scan-1']);
    expect(result.duplicatePunchIds).toEqual(['scan-2', 'scan-3', 'scan-4', 'scan-5']);
  });

  it('debounces repeated IN scans and applies per-template lateness grace', () => {
    const template = { ...instanceFor().template, lateGraceMin: 20 };
    const scans = [
      punch('in', '2026-11-09 09:55:36'),
      punch('repeat-1', '2026-11-09 09:55:44'),
      punch('repeat-2', '2026-11-09 09:55:56'),
      punch('out', '2026-11-09 22:00:00'),
    ];
    const result = matchPunches([instanceFor('2026-11-09', template)], scans);
    expect(result.shifts[0]?.punchIn?.local).toBe('2026-11-09 09:55:36');
    expect(result.shifts[0]?.lateMinutes).toBe(0);
    expect(result.duplicatePunchIds).toEqual(['repeat-1', 'repeat-2']);

    const atGrace = matchPunches(
      [instanceFor('2026-11-09', template)],
      [punch('grace', '2026-11-09 10:20:59')],
    );
    const insideGrace = matchPunches(
      [instanceFor('2026-11-09', template)],
      [punch('inside-grace', '2026-11-09 10:15:00')],
    );
    const afterGrace = matchPunches(
      [instanceFor('2026-11-09', template)],
      [punch('late', '2026-11-09 10:21:00')],
    );
    expect(atGrace.shifts[0]?.lateMinutes).toBe(0);
    expect(insideGrace.shifts[0]?.lateMinutes).toBe(0);
    expect(afterGrace.shifts[0]?.lateMinutes).toBe(21);
  });

  it('calculates overnight overtime from the shift start date', () => {
    const evening = {
      ...instanceFor().template,
      id: 'evening-v2',
      startMin: 780,
      endMin: 1500,
      inFromMin: 760,
      inToMin: 840,
      outFromMin: 1490,
      outToMin: null,
      otCapMin: 480,
    };
    const first = matchPunches(
      [instanceFor('2026-11-09', evening)],
      [punch('in-a', '2026-11-09 13:01:54'), punch('out-a', '2026-11-10 02:11:38')],
    );
    const second = matchPunches(
      [instanceFor('2026-11-09', evening)],
      [punch('in-b', '2026-11-09 13:04:14'), punch('out-b', '2026-11-10 01:49:32')],
    );
    expect(first.shifts[0]?.overtimeMinutes).toBe(71);
    expect(first.shifts[0]?.instance.date).toBe('2026-11-09');
    expect(second.shifts[0]?.overtimeMinutes).toBe(49);
  });

  it('accepts early checkout candidates and flags a stay under 180 minutes', () => {
    const early = matchPunches(
      [instanceFor()],
      [punch('in', '2026-11-09 10:00:00'), punch('out', '2026-11-09 21:52:00')],
    );
    expect(early.shifts[0]?.punchOut?.rawPunchId).toBe('out');
    expect(early.shifts[0]?.earlyLeaveMinutes).toBe(8);

    const short = matchPunches(
      [instanceFor()],
      [punch('in-short', '2026-11-09 10:00:00'), punch('out-short', '2026-11-09 10:40:00')],
    );
    expect(short.shifts[0]?.punchOut?.rawPunchId).toBe('out-short');
    expect(short.shifts[0]?.reviewFlags).toContain('SHORT_STAY');
  });

  it('does not let an open-ended OUT zone steal the next shift IN', () => {
    const openEnded = {
      ...instanceFor().template,
      outToMin: null,
      otCapMin: 720,
    };
    const instances = [instanceFor('2026-11-09', openEnded), instanceFor('2026-11-10', openEnded)];
    const result = matchPunches(instances, [
      punch('day-1-in', '2026-11-09 10:00:00'),
      punch('day-1-out', '2026-11-09 22:00:00'),
      punch('day-2-in', '2026-11-10 09:50:00'),
      punch('day-2-out', '2026-11-10 22:00:00'),
    ]);
    expect(result.shifts[0]?.punchOut?.rawPunchId).toBe('day-1-out');
    expect(result.shifts[1]?.punchIn?.rawPunchId).toBe('day-2-in');
  });

  it('applies manual corrections without mutating raw punches', () => {
    const raw = [punch('in', '2026-11-09 10:20:00'), punch('out', '2026-11-09 21:50:00')];
    const result = matchPunches([instanceFor()], raw, {
      corrections: [
        {
          employeeId: 'E1',
          shiftDate: '2026-11-09',
          field: 'in',
          newTimeLocal: '2026-11-09 09:55:00',
          reason: 'Approved correction',
        },
        {
          employeeId: 'E1',
          shiftDate: '2026-11-09',
          field: 'out',
          newTimeLocal: null,
          reason: 'Invalid device punch',
        },
      ],
    });
    expect(result.shifts[0]?.punchIn).toMatchObject({
      source: 'manual',
      local: '2026-11-09 09:55:00',
    });
    expect(result.shifts[0]?.punchOut).toBeUndefined();
    expect(raw[0]?.punchedAtLocal).toBe('2026-11-09 10:20:00');
  });

  it('ignores an OUT correction that is not after IN and flags review', () => {
    const result = matchPunches([instanceFor()], [], {
      corrections: [
        {
          employeeId: 'E1',
          shiftDate: '2026-11-09',
          field: 'in',
          newTimeLocal: '2026-11-09 10:00:00',
          reason: 'Manual IN',
        },
        {
          employeeId: 'E1',
          shiftDate: '2026-11-09',
          field: 'out',
          newTimeLocal: '2026-11-09 09:59:00',
          reason: 'Bad OUT',
        },
      ],
    });
    expect(result.shifts[0]?.punchOut).toBeUndefined();
    expect(result.shifts[0]?.reviewFlags).toContain('OUT_BEFORE_IN');
  });

  it('reports malformed timestamps and supports an explicit device-ID map', () => {
    const result = matchPunches(
      [instanceFor()],
      [
        { id: 'bad', deviceUserId: '001', punchedAtLocal: 'bad' },
        { id: 'in', deviceUserId: '001', punchedAtLocal: '2026-11-09 10:00:00' },
      ],
      { deviceUserIdByEmployee: { E1: '001' } },
    );
    expect(result.invalidPunchIds).toEqual(['bad']);
    expect(result.shifts[0]?.punchIn?.rawPunchId).toBe('in');
  });

  it('never uses one raw punch for two shift instances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (inOffset, outOffset) => {
          const instances = [instanceFor('2026-11-09'), instanceFor('2026-11-10')];
          const pad = (value: number): string => String(value).padStart(2, '0');
          const punches: RawPunch[] = instances.flatMap((instance, index) => {
            const inHour = 9 + Math.floor((40 + inOffset) / 60);
            const inMinute = (40 + inOffset) % 60;
            const outHour = 21 + Math.floor((40 + outOffset) / 60);
            const outMinute = (40 + outOffset) % 60;
            return [
              punch(`in-${index}`, `${instance.date} ${pad(inHour)}:${pad(inMinute)}:00`),
              punch(`out-${index}`, `${instance.date} ${pad(outHour)}:${pad(outMinute)}:00`),
            ];
          });
          const result = matchPunches(instances, punches);
          expect(new Set(result.usedPunchIds).size).toBe(result.usedPunchIds.length);
        },
      ),
    );
  });
});
