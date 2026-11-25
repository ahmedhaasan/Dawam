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
  const duplicatePunchIds: string[] = [];
  const kept: ParsedRawPunch[] = [];
  const lastKeptByDevice = new Map<string, ParsedRawPunch>();
  for (const parsed of valid) {
    const previous = lastKeptByDevice.get(parsed.punch.deviceUserId);
    if (previous && parsed.time.epochMs - previous.time.epochMs <= 300_000) {
      duplicatePunchIds.push(parsed.punch.id);
      continue;
    }
    kept.push(parsed);
    lastKeptByDevice.set(parsed.punch.deviceUserId, parsed);
  }

  const orderedInstances = [...instances].sort(
    (left, right) => left.window.inFrom.epochMs - right.window.inFrom.epochMs,
  );
  const used = new Set<string>();
  const covered = new Set<string>();
  const shifts: MatchedShift[] = [];

  for (const [instanceIndex, instance] of orderedInstances.entries()) {
    const deviceUserId =
      options.deviceUserIdByEmployee?.[instance.employeeId] ?? instance.employeeId;
    const employeePunches = kept.filter(({ punch }) => punch.deviceUserId === deviceUserId);
    const nextInstance = orderedInstances
      .slice(instanceIndex + 1)
      .find((candidate) => candidate.employeeId === instance.employeeId);
    const isOpenEnded = instance.template.outToMin === null;
    const openEndedLimit =
      isOpenEnded && nextInstance
        ? Math.min(instance.window.outTo.epochMs, nextInstance.window.inFrom.epochMs)
        : instance.window.outTo.epochMs;
    const effectiveOutTo =
      isOpenEnded &&
      nextInstance &&
      nextInstance.window.inFrom.epochMs < instance.window.outTo.epochMs
        ? nextInstance.window.inFrom
        : instance.window.outTo;
    const effectiveInstance =
      effectiveOutTo === instance.window.outTo
        ? instance
        : { ...instance, window: { ...instance.window, outTo: effectiveOutTo } };
    const isBeforeOutZoneEnd = (epochMs: number): boolean =>
      epochMs <= openEndedLimit &&
      (!isOpenEnded || !nextInstance || epochMs < nextInstance.window.inFrom.epochMs);

    const inCandidates = employeePunches.filter(({ punch, time }) => {
      const matches = inRange(
        time.epochMs,
        instance.window.inFrom.epochMs,
        instance.window.inTo.epochMs,
      );
      if (matches) covered.add(punch.id);
      return matches && !used.has(punch.id);
    });
    const rawIn = inCandidates[0];
    const outCandidates = employeePunches.filter(({ punch, time }) => {
      const afterIn = rawIn
        ? time.epochMs - rawIn.time.epochMs > 5 * 60_000
        : time.epochMs >= instance.window.outFrom.epochMs;
      const matches = afterIn && isBeforeOutZoneEnd(time.epochMs);
      if (matches) covered.add(punch.id);
      return matches && !used.has(punch.id) && punch.id !== rawIn?.punch.id;
    });

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

    const actualLateMinutes = punchIn
      ? Math.max(0, wholeMinutesBetween(punchIn.epochMs, instance.window.start.epochMs))
      : null;
    const lateMinutes =
      actualLateMinutes === null
        ? null
        : actualLateMinutes <= (instance.template.lateGraceMin ?? 0)
          ? 0
          : actualLateMinutes;
    const earlyLeaveMinutes = punchOut
      ? Math.max(0, wholeMinutesBetween(instance.window.end.epochMs, punchOut.epochMs))
      : null;
    const overtimeMinutes = punchOut
      ? Math.max(0, wholeMinutesBetween(punchOut.epochMs, instance.window.end.epochMs))
      : null;
    const hours = punchIn && punchOut ? (punchOut.epochMs - punchIn.epochMs) / 3_600_000 : null;
    if (hours !== null && hours < 3) flags.push('SHORT_STAY');

    const result: MatchedShift = {
      instance: effectiveInstance,
      hours,
      lateMinutes,
      earlyLeaveMinutes,
      overtimeMinutes,
      reviewFlags: unique(flags),
      ...(punchIn ? { punchIn } : {}),
      ...(punchOut ? { punchOut } : {}),
    };
    shifts.push(result);
  }

  const reviewPunchIds = kept
    .filter(({ punch }) => !covered.has(punch.id))
    .map(({ punch }) => punch.id);

  return {
    shifts,
    usedPunchIds: [...used],
    reviewPunchIds,
    invalidPunchIds,
    keptPunchIds: kept.map(({ punch }) => punch.id),
    duplicatePunchIds,
  };
};
