import { DateTime } from 'luxon';

import type {
  DstFlag,
  LocalDate,
  LocalDateTime,
  Result,
  ShiftTemplate,
  ShiftWindow,
  ZonedLocalTime,
} from './types.js';

export const DAWAM_TIME_ZONE = 'Africa/Cairo' as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export interface TimeParseError {
  code: 'INVALID_DATE' | 'INVALID_LOCAL_DATE_TIME';
  value: string;
}

const isIntegerParts = (parts: readonly number[]): boolean =>
  parts.every((part) => Number.isInteger(part));

export const isValidLocalDate = (value: string): value is LocalDate => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (!isIntegerParts(parts)) return false;
  const [year, month, day] = parts;
  const parsed = DateTime.fromObject({ year, month, day }, { zone: DAWAM_TIME_ZONE });
  return parsed.isValid && parsed.toFormat('yyyy-MM-dd') === value;
};

export const parseLocalDateTime = (value: string): Result<ZonedLocalTime, TimeParseError> => {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return { ok: false, error: { code: 'INVALID_LOCAL_DATE_TIME', value } };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!isIntegerParts([year, month, day, hour, minute, second])) {
    return { ok: false, error: { code: 'INVALID_LOCAL_DATE_TIME', value } };
  }

  const requested = { year, month, day, hour, minute, second, millisecond: 0 };
  const parsed = DateTime.fromObject(requested, { zone: DAWAM_TIME_ZONE });
  if (!parsed.isValid) {
    return { ok: false, error: { code: 'INVALID_LOCAL_DATE_TIME', value } };
  }

  const flags: DstFlag[] = [];
  if (parsed.toFormat('yyyy-MM-dd HH:mm:ss') !== value) {
    flags.push('NONEXISTENT_LOCAL_TIME');
  }

  const possible = parsed.getPossibleOffsets();
  if (possible.length > 1) flags.push('AMBIGUOUS_LOCAL_TIME');

  // For an overlap, the first physical instant is deterministic and uses the earlier occurrence.
  const selected = possible.reduce(
    (earliest, candidate) => (candidate.toMillis() < earliest.toMillis() ? candidate : earliest),
    parsed,
  );

  return {
    ok: true,
    value: {
      raw: value,
      epochMs: selected.toMillis(),
      offsetMinutes: selected.offset,
      flags,
    },
  };
};

const localAtOffset = (
  date: LocalDate,
  minuteOffset: number,
): Result<ZonedLocalTime, TimeParseError> => {
  if (!isValidLocalDate(date) || !Number.isInteger(minuteOffset)) {
    return { ok: false, error: { code: 'INVALID_DATE', value: date } };
  }

  const base = DateTime.fromISO(date, { zone: DAWAM_TIME_ZONE });
  const dayOffset = Math.floor(minuteOffset / 1440);
  const minuteOfDay = ((minuteOffset % 1440) + 1440) % 1440;
  const localDate = base.plus({ days: dayOffset }).toFormat('yyyy-MM-dd');
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return parseLocalDateTime(
    `${localDate} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
  );
};

export const buildShiftWindow = (
  date: LocalDate,
  template: ShiftTemplate,
): Result<ShiftWindow, TimeParseError> => {
  const start = localAtOffset(date, template.startMin);
  if (!start.ok) return start;
  const end = localAtOffset(date, template.endMin);
  if (!end.ok) return end;
  const inFrom = localAtOffset(date, template.inFromMin);
  if (!inFrom.ok) return inFrom;
  const inTo = localAtOffset(date, template.inToMin);
  if (!inTo.ok) return inTo;
  const checkoutOpenBeforeEndMin = template.checkoutOpenBeforeEndMin ?? 10;
  const outFrom = localAtOffset(date, template.endMin - checkoutOpenBeforeEndMin);
  if (!outFrom.ok) return outFrom;
  const outTo = localAtOffset(
    date,
    template.outToMin ?? template.endMin + (template.otCapMin ?? 480),
  );
  if (!outTo.ok) return outTo;

  return {
    ok: true,
    value: {
      start: start.value,
      end: end.value,
      inFrom: inFrom.value,
      inTo: inTo.value,
      outFrom: outFrom.value,
      outTo: outTo.value,
    },
  };
};

export const compareLocalDates = (left: LocalDate, right: LocalDate): number =>
  left.localeCompare(right);

export const isDateInRange = (date: LocalDate, from: LocalDate, to?: LocalDate): boolean =>
  compareLocalDates(date, from) >= 0 && (!to || compareLocalDates(date, to) <= 0);

export const isoWeekday = (date: LocalDate): number | null => {
  if (!isValidLocalDate(date)) return null;
  return DateTime.fromISO(date, { zone: DAWAM_TIME_ZONE }).weekday;
};

export const localDateTimeFromEpoch = (epochMs: number): LocalDateTime =>
  DateTime.fromMillis(epochMs, { zone: DAWAM_TIME_ZONE }).toFormat('yyyy-MM-dd HH:mm:ss');

export const wholeMinutesBetween = (laterEpochMs: number, earlierEpochMs: number): number =>
  Math.floor((laterEpochMs - earlierEpochMs) / 60_000);
