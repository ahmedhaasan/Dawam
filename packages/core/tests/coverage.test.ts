import { describe, expect, it } from 'vitest';

import { isShiftCovered, mergeConfirmedCoverage } from '../src/index.js';
import { instanceFor } from './helpers.js';

describe('confirmed import coverage', () => {
  it('merges overlapping and one-second-adjacent confirmed intervals', () => {
    const merged = mergeConfirmedCoverage([
      {
        fromLocal: '2026-11-09 09:00:00',
        toLocal: '2026-11-09 12:00:00',
        confirmed: true,
      },
      {
        fromLocal: '2026-11-09 12:00:01',
        toLocal: '2026-11-09 23:00:00',
        confirmed: true,
      },
      {
        fromLocal: '2026-11-08 00:00:00',
        toLocal: '2026-11-08 23:59:59',
        confirmed: false,
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      fromLocal: '2026-11-09 09:00:00',
      toLocal: '2026-11-09 23:00:00',
    });
  });

  it('requires the entire IN-to-OUT window to be confirmed', () => {
    const instance = instanceFor();
    expect(
      isShiftCovered(instance, [
        {
          fromLocal: '2026-11-09 09:40:00',
          toLocal: '2026-11-09 23:00:00',
          confirmed: true,
        },
      ]),
    ).toBe(true);
    expect(
      isShiftCovered(instance, [
        {
          fromLocal: '2026-11-09 10:00:00',
          toLocal: '2026-11-09 23:00:00',
          confirmed: true,
        },
      ]),
    ).toBe(false);
  });

  it('ignores invalid and reversed intervals', () => {
    expect(
      mergeConfirmedCoverage([
        { fromLocal: 'bad', toLocal: 'also-bad', confirmed: true },
        {
          fromLocal: '2026-11-10 00:00:00',
          toLocal: '2026-11-09 00:00:00',
          confirmed: true,
        },
      ]),
    ).toEqual([]);
  });
});
