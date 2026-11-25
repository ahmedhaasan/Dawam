import type { TFunction } from 'i18next';
import type { PayrollPolicyConfigDto } from '../../shared/ipc';

export type LateMethod =
  'none' | 'minutes' | 'hours' | 'full_day_any' | 'full_day_threshold' | 'custom_amount';
export type OvertimeMethod = 'none' | 'fixed_per_hour' | 'extra_days' | 'custom_amount';
export type OvertimeRounding = 'exact' | 'down_30' | 'down_60';

/** Month-default methods offered in the rules dialog (custom amounts are per day only). */
export const DEFAULT_LATE_METHODS: readonly LateMethod[] = [
  'minutes',
  'hours',
  'full_day_any',
  'full_day_threshold',
  'none',
];
export const DEFAULT_OVERTIME_METHODS: readonly OvertimeMethod[] = [
  'fixed_per_hour',
  'extra_days',
  'none',
];
export const DAY_LATE_METHODS: readonly LateMethod[] = [...DEFAULT_LATE_METHODS, 'custom_amount'];
export const DAY_OVERTIME_METHODS: readonly OvertimeMethod[] = [
  ...DEFAULT_OVERTIME_METHODS,
  'custom_amount',
];

/** Editable rule draft; money fields are EGP strings as typed, converted to piastres once. */
export interface RuleDraft {
  lateMethod: LateMethod;
  lateHourPrice: string;
  hourThreshold: string;
  shortAmount: string;
  fullDayThreshold: string;
  grace: string;
  overtimeMethod: OvertimeMethod;
  overtimeHourPrice: string;
  overtimeMinimum: string;
  overtimeRounding: OvertimeRounding;
  extraDayHours: string;
}

export const DEFAULT_RULES: RuleDraft = {
  lateMethod: 'hours',
  lateHourPrice: '100',
  hourThreshold: '30',
  shortAmount: '25',
  fullDayThreshold: '60',
  grace: '0',
  overtimeMethod: 'none',
  overtimeHourPrice: '60',
  overtimeMinimum: '15',
  overtimeRounding: 'exact',
  extraDayHours: '12',
};

export const egpToMinor = (value: string): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
};
export const wholeNumber = (value: string, minimum = 0): number => {
  const parsed = Math.trunc(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : minimum;
};
const minorToEgp = (minor: number): string => String(minor / 100);

export const draftToConfig = (
  draft: RuleDraft,
  capPerDayMinor: number,
): Extract<PayrollPolicyConfigDto, { version: 2 }> => ({
  version: 2,
  lateRule: {
    method: draft.lateMethod,
    hourlyAmountMinor: egpToMinor(draft.lateHourPrice),
    hourThresholdMinutes: wholeNumber(draft.hourThreshold),
    shortLatenessAmountMinor: egpToMinor(draft.shortAmount),
    fullDayThresholdMinutes: wholeNumber(draft.fullDayThreshold),
    graceMinutes: wholeNumber(draft.grace),
    capPerDayMinor,
  },
  overtimeRule: {
    method: draft.overtimeMethod,
    amountPerHourMinor: egpToMinor(draft.overtimeHourPrice),
    minimumMinutes: wholeNumber(draft.overtimeMinimum),
    rounding: draft.overtimeRounding,
    hoursPerExtraDay: wholeNumber(draft.extraDayHours, 1),
  },
  absenceMultiplier: { numerator: 1, denominator: 1 },
});

export const configToDraft = (config: PayrollPolicyConfigDto): RuleDraft | null => {
  if (!('version' in config) || config.version !== 2) return null;
  return {
    lateMethod: config.lateRule.method,
    lateHourPrice: minorToEgp(config.lateRule.hourlyAmountMinor),
    hourThreshold: String(config.lateRule.hourThresholdMinutes),
    shortAmount: minorToEgp(config.lateRule.shortLatenessAmountMinor),
    fullDayThreshold: String(config.lateRule.fullDayThresholdMinutes),
    grace: String(config.lateRule.graceMinutes),
    overtimeMethod: config.overtimeRule.method,
    overtimeHourPrice: minorToEgp(config.overtimeRule.amountPerHourMinor),
    overtimeMinimum: String(config.overtimeRule.minimumMinutes),
    overtimeRounding: config.overtimeRule.rounding,
    extraDayHours: String(config.overtimeRule.hoursPerExtraDay),
  };
};

type Translate = TFunction;

/** Plain-language explanation of a lateness method using the current shared prices. */
export const explainLate = (
  t: Translate,
  method: LateMethod,
  draft: RuleDraft,
  money: (minor: number) => string,
  dailyWageMinor: number,
): string => {
  const hourMinor = egpToMinor(draft.lateHourPrice);
  const threshold =
    method === 'full_day_threshold'
      ? wholeNumber(draft.fullDayThreshold)
      : wholeNumber(draft.hourThreshold);
  return t(`payroll.board.lateExplain.${method}`, {
    perMinute: money(hourMinor / 60),
    perHour: money(hourMinor),
    grace: wholeNumber(draft.grace),
    threshold,
    short: money(egpToMinor(draft.shortAmount)),
    daily: money(dailyWageMinor),
  });
};

export const explainOvertime = (
  t: Translate,
  method: OvertimeMethod,
  draft: RuleDraft,
  money: (minor: number) => string,
  dailyWageMinor: number,
): string =>
  t(`payroll.board.overtimeExplain.${method}`, {
    perHour: money(egpToMinor(draft.overtimeHourPrice)),
    minimum: wholeNumber(draft.overtimeMinimum),
    hours: wholeNumber(draft.extraDayHours, 1),
    daily: money(dailyWageMinor),
  });
