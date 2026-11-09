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
    expect(result.shifts[0]?.punchOut?.rawPunchId).toBe('out-last');
    expect(result.shifts[0]?.hours).toBeCloseTo(12.25);
    expect(result.shifts[0]?.lateMinutes).toBe(0);
    expect(result.shifts[0]?.earlyLeaveMinutes).toBe(0);
    expect(result.reviewPunchIds).toEqual(['outside']);
    expect(result.usedPunchIds).toEqual(['in-first', 'out-last']);
  });

  it('truncates seconds when calculating lateness', () => {
    const result = matchPunches(
      [instanceFor()],
      [punch('in', '2026-11-09 10:00:59'), punch('out', '2026-11-09 22:00:00')],
    );
    expect(result.shifts[0]?.lateMinutes).toBe(0);
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
