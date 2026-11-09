import { describe, expect, it } from 'vitest';

import { computeAttendanceStatus, createShiftInstance, matchPunches } from '../src/index.js';
import { evening, shiftSchedule } from './helpers.js';

describe('overnight month attribution', () => {
  it('keeps the OUT on the shift start date and waits for next-month coverage', () => {
    const schedule = shiftSchedule('2026-11-30', evening);
    const instance = createShiftInstance(schedule);
    expect(instance.ok && instance.value).toBeTruthy();
    if (!instance.ok || !instance.value) return;
    expect(instance.value.window.outTo.raw).toBe('2026-12-01 02:00:00');

    const matched = matchPunches(
      [instance.value],
      [
        {
          id: 'in',
          deviceUserId: 'E1',
          punchedAtLocal: '2026-11-30 12:50:00',
        },
      ],
    ).shifts[0]!;
    const result = computeAttendanceStatus({
      schedule,
      matched,
      coverage: [
        {
          fromLocal: '2026-11-30 00:00:00',
          toLocal: '2026-11-30 23:59:59',
          confirmed: true,
        },
      ],
      nowLocal: '2026-12-01 03:00:00',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { date: '2026-11-30', status: 'PENDING_IMPORT' },
    });
  });
});
