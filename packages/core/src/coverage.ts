import { localDateTimeFromEpoch, parseLocalDateTime } from './time.js';
import type { ImportCoverageInterval, ShiftInstance } from './types.js';

export interface MergedCoverageInterval {
  fromLocal: string;
  toLocal: string;
  fromEpochMs: number;
  toEpochMs: number;
}

export const mergeConfirmedCoverage = (
  intervals: readonly ImportCoverageInterval[],
): readonly MergedCoverageInterval[] => {
  const parsed = intervals
    .filter((interval) => interval.confirmed)
    .flatMap((interval) => {
      const from = parseLocalDateTime(interval.fromLocal);
      const to = parseLocalDateTime(interval.toLocal);
      if (!from.ok || !to.ok || to.value.epochMs < from.value.epochMs) return [];
      return [
        {
          fromEpochMs: from.value.epochMs,
          toEpochMs: to.value.epochMs,
        },
      ];
    })
    .sort((left, right) => left.fromEpochMs - right.fromEpochMs);

  const merged: Array<{ fromEpochMs: number; toEpochMs: number }> = [];
  for (const interval of parsed) {
    const previous = merged.at(-1);
    if (previous && interval.fromEpochMs <= previous.toEpochMs + 1000) {
      previous.toEpochMs = Math.max(previous.toEpochMs, interval.toEpochMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.map((interval) => ({
    ...interval,
    fromLocal: localDateTimeFromEpoch(interval.fromEpochMs),
    toLocal: localDateTimeFromEpoch(interval.toEpochMs),
  }));
};

export const isShiftCovered = (
  instance: ShiftInstance,
  intervals: readonly ImportCoverageInterval[],
): boolean => {
  const merged = mergeConfirmedCoverage(intervals);
  return merged.some(
    (interval) =>
      interval.fromEpochMs <= instance.window.inFrom.epochMs &&
      interval.toEpochMs >= instance.window.outTo.epochMs,
  );
};
