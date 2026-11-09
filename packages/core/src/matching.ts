import { parseLocalDateTime, wholeMinutesBetween } from './time.js';
import type {
  DstFlag,
  EmployeeId,
  MatchReviewFlag,
  MatchPunchesResult,
  MatchedPunch,
  MatchedShift,
  PunchCorrection,
  RawPunch,
  ShiftInstance,
  ZonedLocalTime,
} from './types.js';

export interface MatchPunchesOptions {
  corrections?: readonly PunchCorrection[];
  deviceUserIdByEmployee?: Readonly<Record<EmployeeId, string>>;
}

interface ParsedRawPunch {
  punch: RawPunch;
  time: ZonedLocalTime;
}

const inRange = (epochMs: number, from: number, to: number): boolean =>
  epochMs >= from && epochMs <= to;

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const rawMatch = (parsed: ParsedRawPunch): MatchedPunch => ({
  local: parsed.punch.punchedAtLocal,
  epochMs: parsed.time.epochMs,
  source: 'raw',
  rawPunchId: parsed.punch.id,
  flags: parsed.time.flags,
});

const manualMatch = (local: string): MatchedPunch | null => {
  const parsed = parseLocalDateTime(local);
  if (!parsed.ok) return null;
  return {
    local,
    epochMs: parsed.value.epochMs,
    source: 'manual',
    flags: parsed.value.flags,
  };
};

const correctionFor = (
  corrections: readonly PunchCorrection[],
  instance: ShiftInstance,
  field: 'in' | 'out',
): PunchCorrection | undefined =>
  corrections.find(
    (correction) =>
      correction.employeeId === instance.employeeId &&
      correction.shiftDate === instance.date &&
      correction.field === field,
  );

const windowFlags = (instance: ShiftInstance): DstFlag[] =>
  unique(
    [
      instance.window.start,
      instance.window.end,
      instance.window.inFrom,
      instance.window.inTo,
      instance.window.outFrom,
      instance.window.outTo,
    ].flatMap((time) => time.flags),
  );

export const matchPunches = (
  instances: readonly ShiftInstance[],
  punches: readonly RawPunch[],
  options: MatchPunchesOptions = {},
): MatchPunchesResult => {
  const corrections = options.corrections ?? [];
  const valid: ParsedRawPunch[] = [];
  const invalidPunchIds: string[] = [];
  for (const punch of punches) {
    const parsed = parseLocalDateTime(punch.punchedAtLocal);
    if (parsed.ok) valid.push({ punch, time: parsed.value });
    else invalidPunchIds.push(punch.id);
  }

  valid.sort((left, right) => left.time.epochMs - right.time.epochMs);
  const orderedInstances = [...instances].sort(
    (left, right) => left.window.inFrom.epochMs - right.window.inFrom.epochMs,
  );
  const used = new Set<string>();
  const covered = new Set<string>();
  const shifts: MatchedShift[] = [];

  for (const instance of orderedInstances) {
    const deviceUserId =
      options.deviceUserIdByEmployee?.[instance.employeeId] ?? instance.employeeId;
    const employeePunches = valid.filter(({ punch }) => punch.deviceUserId === deviceUserId);

    const inCandidates = employeePunches.filter(({ punch, time }) => {
      const matches = inRange(
        time.epochMs,
        instance.window.inFrom.epochMs,
        instance.window.inTo.epochMs,
      );
      if (matches) covered.add(punch.id);
      return matches && !used.has(punch.id);
    });
    const outCandidates = employeePunches.filter(({ punch, time }) => {
      const matches = inRange(
        time.epochMs,
        instance.window.outFrom.epochMs,
        instance.window.outTo.epochMs,
      );
      if (matches) covered.add(punch.id);
      return matches && !used.has(punch.id);
    });

    const rawIn = inCandidates[0];
    const rawOut = outCandidates.at(-1);
    if (rawIn) used.add(rawIn.punch.id);
    if (rawOut && !used.has(rawOut.punch.id)) used.add(rawOut.punch.id);

    let punchIn = rawIn ? rawMatch(rawIn) : undefined;
    let punchOut = rawOut ? rawMatch(rawOut) : undefined;
    const inCorrection = correctionFor(corrections, instance, 'in');
    const outCorrection = correctionFor(corrections, instance, 'out');
    if (inCorrection) {
      punchIn =
        inCorrection.newTimeLocal === null
          ? undefined
          : (manualMatch(inCorrection.newTimeLocal) ?? undefined);
    }
    if (outCorrection) {
      punchOut =
        outCorrection.newTimeLocal === null
          ? undefined
          : (manualMatch(outCorrection.newTimeLocal) ?? undefined);
    }

    const flags: MatchReviewFlag[] = unique([
      ...windowFlags(instance),
      ...(punchIn?.flags ?? []),
      ...(punchOut?.flags ?? []),
    ]);
    if (punchIn && punchOut && punchOut.epochMs <= punchIn.epochMs) {
      punchOut = undefined;
      flags.push('OUT_BEFORE_IN');
    }

    const lateMinutes = punchIn
      ? Math.max(0, wholeMinutesBetween(punchIn.epochMs, instance.window.start.epochMs))
      : null;
    const earlyLeaveMinutes = punchOut
      ? Math.max(0, wholeMinutesBetween(instance.window.end.epochMs, punchOut.epochMs))
      : null;
    const hours = punchIn && punchOut ? (punchOut.epochMs - punchIn.epochMs) / 3_600_000 : null;

    const result: MatchedShift = {
      instance,
      hours,
      lateMinutes,
      earlyLeaveMinutes,
      reviewFlags: unique(flags),
      ...(punchIn ? { punchIn } : {}),
      ...(punchOut ? { punchOut } : {}),
    };
    shifts.push(result);
  }

  const reviewPunchIds = valid
    .filter(({ punch }) => !covered.has(punch.id))
    .map(({ punch }) => punch.id);

  return {
    shifts,
    usedPunchIds: [...used],
    reviewPunchIds,
    invalidPunchIds,
  };
};
