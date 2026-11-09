import { describe, expect, it } from 'vitest';

import {
  buildShiftWindow,
  isValidLocalDate,
  parseLocalDateTime,
  wholeMinutesBetween,
} from '../src/index.js';
import { evening } from './helpers.js';

describe('Cairo wall-clock time', () => {
  it('validates dates and local timestamps strictly', () => {
    expect(isValidLocalDate('2026-02-28')).toBe(true);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(parseLocalDateTime('not-a-time').ok).toBe(false);
    expect(parseLocalDateTime('2026-02-30 10:00:00').ok).toBe(false);
  });

  it('flags the nonexistent spring-forward hour', () => {
    const result = parseLocalDateTime('2026-04-24 00:30:00');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.flags).toContain('NONEXISTENT_LOCAL_TIME');
  });

  it('selects the earlier occurrence and flags the autumn overlap', () => {
    const result = parseLocalDateTime('2026-10-29 23:30:00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags).toContain('AMBIGUOUS_LOCAL_TIME');
      expect(result.value.offsetMinutes).toBe(180);
    }
  });

  it('builds next-day and year-boundary windows from wall-clock offsets', () => {
    const window = buildShiftWindow('2026-12-31', evening);
    expect(window.ok).toBe(true);
    if (window.ok) {
      expect(window.value.end.raw).toBe('2027-01-01 01:00:00');
      expect(window.value.outTo.raw).toBe('2027-01-01 02:00:00');
    }
  });

  it('computes real elapsed duration across both Egypt DST transitions', () => {
    const springTemplate = {
      ...evening,
      startMin: 1380,
      endMin: 1560,
      inFromMin: 1360,
      inToMin: 1400,
      outFromMin: 1540,
      outToMin: 1580,
    };
    const spring = buildShiftWindow('2026-04-23', springTemplate);
    expect(spring.ok).toBe(true);
    if (spring.ok) {
      expect(wholeMinutesBetween(spring.value.end.epochMs, spring.value.start.epochMs)).toBe(120);
    }

    const autumnTemplate = {
      ...springTemplate,
      startMin: 1320,
      endMin: 1440,
      inFromMin: 1300,
      inToMin: 1340,
      outFromMin: 1420,
      outToMin: 1460,
    };
    const autumn = buildShiftWindow('2026-10-29', autumnTemplate);
    expect(autumn.ok).toBe(true);
    if (autumn.ok) {
      expect(wholeMinutesBetween(autumn.value.end.epochMs, autumn.value.start.epochMs)).toBe(180);
    }
  });
});
