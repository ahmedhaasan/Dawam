import type {
  CustomTier,
  PayrollDateResult,
  PayrollInput,
  PayrollOptions,
  PayrollResult,
  PayrollV2Input,
  PayrollV2LateMethod,
  PayrollV2Result,
  Result,
} from './types.js';

export type PayrollErrorCode =
  | 'INVALID_MONTHLY_SALARY'
  | 'INVALID_WAGE_BASIS'
  | 'INVALID_LATE_MINUTES'
  | 'DUPLICATE_DATE'
  | 'INVALID_GRACE'
  | 'INVALID_CAP'
  | 'INVALID_HOURLY_BASIS'
  | 'MISSING_SCHEDULED_MINUTES'
  | 'INVALID_ABSENCE_MULTIPLIER'
  | 'INVALID_OTHER_ITEMS'
  | 'INVALID_THRESHOLD'
  | 'INVALID_FIXED_HOURLY_AMOUNT'
  | 'INVALID_TIER'
  | 'OVERLAPPING_TIERS'
  | 'INVALID_OVERTIME_MINUTES'
  | 'INVALID_OVERTIME_RULE'
  | 'INVALID_LATE_RULE'
  | 'INVALID_CUSTOM_AMOUNT'
  | 'REASON_REQUIRED';

export interface PayrollError {
  code: PayrollErrorCode;
  date?: string;
  tierIndex?: number;
}

const isNonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export const roundHalfUp = (numerator: number, denominator: number): number => {
  if (!Number.isSafeInteger(numerator) || !isPositiveInteger(denominator)) {
    throw new TypeError('roundHalfUp requires safe integer inputs and a positive denominator');
  }
  const negative = numerator < 0;
  const absolute = BigInt(Math.abs(numerator));
  const divisor = BigInt(denominator);
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  return Number(negative ? -rounded : rounded);
};

const safeProduct = (...values: readonly number[]): number => {
  const product = values.reduce((result, value) => result * BigInt(value), 1n);
  const numeric = Number(product);
  if (!Number.isSafeInteger(numeric))
    throw new RangeError('Payroll arithmetic exceeded safe range');
  return numeric;
};

const validateTier = (tier: CustomTier, index: number): PayrollError[] => {
  const errors: PayrollError[] = [];
  if (
    !isNonNegativeInteger(tier.fromMin) ||
    (tier.toMin !== null && (!isNonNegativeInteger(tier.toMin) || tier.toMin < tier.fromMin))
  ) {
    errors.push({ code: 'INVALID_TIER', tierIndex: index });
  }
  const hasAmount = tier.amountMinor !== undefined;
  const hasFraction = tier.fractionOfDaily !== undefined;
  if (hasAmount === hasFraction) errors.push({ code: 'INVALID_TIER', tierIndex: index });
  if (hasAmount && !isNonNegativeInteger(tier.amountMinor!)) {
    errors.push({ code: 'INVALID_TIER', tierIndex: index });
  }
  if (
    hasFraction &&
    (!isNonNegativeInteger(tier.fractionOfDaily!.numerator) ||
      !isPositiveInteger(tier.fractionOfDaily!.denominator))
  ) {
    errors.push({ code: 'INVALID_TIER', tierIndex: index });
  }
  return errors;
};

export const validatePayrollInput = (
  input: PayrollInput,
): Result<PayrollInput, readonly PayrollError[]> => {
  const errors: PayrollError[] = [];
  if (!isNonNegativeInteger(input.monthlySalaryMinor)) {
    errors.push({ code: 'INVALID_MONTHLY_SALARY' });
  }
  if (!isPositiveInteger(input.wageBasisDays)) errors.push({ code: 'INVALID_WAGE_BASIS' });

  const dates = new Set<string>();
  for (const day of input.days) {
    if (!isNonNegativeInteger(day.lateMinutes)) {
      errors.push({ code: 'INVALID_LATE_MINUTES', date: day.date });
    }
    if (dates.has(day.date)) errors.push({ code: 'DUPLICATE_DATE', date: day.date });
    dates.add(day.date);
  }

  const options = input.options;
  if (options?.graceMinutes !== undefined && !isNonNegativeInteger(options.graceMinutes)) {
    errors.push({ code: 'INVALID_GRACE' });
  }
  if (
    options?.capPerDateMinor !== undefined &&
    options.capPerDateMinor !== null &&
    !isNonNegativeInteger(options.capPerDateMinor)
  ) {
    errors.push({ code: 'INVALID_CAP' });
  }
  if (options?.hourlyBasis?.kind === 'fixed' && !isPositiveInteger(options.hourlyBasis.minutes)) {
    errors.push({ code: 'INVALID_HOURLY_BASIS' });
  }
  if (
    options?.absenceMultiplier &&
    (!isNonNegativeInteger(options.absenceMultiplier.numerator) ||
      !isPositiveInteger(options.absenceMultiplier.denominator))
  ) {
    errors.push({ code: 'INVALID_ABSENCE_MULTIPLIER' });
  }
  if (
    options?.otherApprovedItemsMinor !== undefined &&
    !isNonNegativeInteger(options.otherApprovedItemsMinor)
  ) {
    errors.push({ code: 'INVALID_OTHER_ITEMS' });
  }

  if (
    input.policy.id === 'day_at_threshold' &&
    !isNonNegativeInteger(input.policy.thresholdMinutes)
  ) {
    errors.push({ code: 'INVALID_THRESHOLD' });
  }
  if (
    (input.policy.id === 'fixed_hourly_amount' || input.policy.id === 'fixed_hourly_rounded_up') &&
    !isNonNegativeInteger(input.policy.amountMinor)
  ) {
    errors.push({ code: 'INVALID_FIXED_HOURLY_AMOUNT' });
  }
  if (input.policy.id === 'custom_tiers') {
    input.policy.tiers.forEach((tier, index) => errors.push(...validateTier(tier, index)));
    const ordered = [...input.policy.tiers].sort((left, right) => left.fromMin - right.fromMin);
    ordered.forEach((tier, index) => {
      const previous = ordered[index - 1];
      if (previous && (previous.toMin === null || previous.toMin >= tier.fromMin)) {
        errors.push({ code: 'OVERLAPPING_TIERS', tierIndex: index });
      }
    });
  }

  const usesHourlyBasis =
    input.policy.id === 'hourly_proportional' || input.policy.id === 'hourly_rounded_up';
  const basis = options?.hourlyBasis ?? { kind: 'scheduled_shift' as const };
  if (usesHourlyBasis && basis.kind === 'scheduled_shift') {
    for (const day of input.days) {
      if (day.lateMinutes > 0 && !isPositiveInteger(day.scheduledMinutes ?? 0)) {
        errors.push({ code: 'MISSING_SCHEDULED_MINUTES', date: day.date });
      }
    }
  }

  return errors.length > 0 ? { ok: false, error: errors } : { ok: true, value: input };
};

const applyGrace = (lateMinutes: number, options: PayrollOptions | undefined): number => {
  const grace = options?.graceMinutes ?? 0;
  if ((options?.graceMode ?? 'threshold') === 'subtract') {
    return Math.max(0, lateMinutes - grace);
  }
  return lateMinutes <= grace ? 0 : lateMinutes;
};

const hourlyBasisMinutes = (
  scheduledMinutes: number | undefined,
  options: PayrollOptions | undefined,
): number =>
  options?.hourlyBasis?.kind === 'fixed' ? options.hourlyBasis.minutes : scheduledMinutes!;

interface AmountCalculation {
  units: number;
  amountMinor: number;
}

const amountForTier = (
  tier: CustomTier,
  monthlySalaryMinor: number,
  wageBasisDays: number,
): number => {
  if (tier.amountMinor !== undefined) return tier.amountMinor;
  const fraction = tier.fractionOfDaily!;
  return roundHalfUp(
    safeProduct(monthlySalaryMinor, fraction.numerator),
    safeProduct(wageBasisDays, fraction.denominator),
  );
};

const calculateDateAmount = (
  input: PayrollInput,
  billableMinutes: number,
  scheduledMinutes: number | undefined,
  lateRounding: 'exact' | 'hour_up' = 'exact',
): AmountCalculation => {
  const { policy, monthlySalaryMinor, wageBasisDays } = input;
  if (billableMinutes === 0 || policy.id === 'none') return { units: 0, amountMinor: 0 };

  switch (policy.id) {
    case 'fixed_hourly_amount':
      if (lateRounding === 'hour_up') {
        const units = Math.ceil(billableMinutes / 60);
        return { units, amountMinor: safeProduct(policy.amountMinor, units) };
      }
      return {
        units: billableMinutes / 60,
        amountMinor: roundHalfUp(safeProduct(policy.amountMinor, billableMinutes), 60),
      };
    case 'fixed_hourly_rounded_up': {
      const units = Math.ceil(billableMinutes / 60);
      return { units, amountMinor: safeProduct(policy.amountMinor, units) };
    }
    case 'hourly_proportional': {
      const basisMinutes = hourlyBasisMinutes(scheduledMinutes, input.options);
      return {
        units: billableMinutes,
        amountMinor: roundHalfUp(
          safeProduct(monthlySalaryMinor, billableMinutes),
          safeProduct(wageBasisDays, basisMinutes),
        ),
      };
    }
    case 'hourly_rounded_up': {
      const units = Math.ceil(billableMinutes / 60);
      const basisMinutes = hourlyBasisMinutes(scheduledMinutes, input.options);
      return {
        units,
        amountMinor: roundHalfUp(
          safeProduct(monthlySalaryMinor, units, 60),
          safeProduct(wageBasisDays, basisMinutes),
        ),
      };
    }
    case 'day_per_started_hour': {
      const units = Math.ceil(billableMinutes / 60);
      return {
        units,
        amountMinor: roundHalfUp(safeProduct(monthlySalaryMinor, units), wageBasisDays),
      };
    }
    case 'day_any_lateness':
      return {
        units: 1,
        amountMinor: roundHalfUp(monthlySalaryMinor, wageBasisDays),
      };
    case 'day_at_threshold': {
      if (billableMinutes < policy.thresholdMinutes) return { units: 0, amountMinor: 0 };
      return {
        units: 1,
        amountMinor: roundHalfUp(monthlySalaryMinor, wageBasisDays),
      };
    }
    case 'custom_tiers': {
      const tier = policy.tiers.find(
        (candidate) =>
          billableMinutes >= candidate.fromMin &&
          (candidate.toMin === null || billableMinutes <= candidate.toMin),
      );
      return tier
        ? {
            units: 1,
            amountMinor: amountForTier(tier, monthlySalaryMinor, wageBasisDays),
          }
        : { units: 0, amountMinor: 0 };
    }
  }
};

export const calculatePayroll = (
  input: PayrollInput,
): Result<PayrollResult, readonly PayrollError[]> => {
  const validation = validatePayrollInput(input);
  if (!validation.ok) return validation;

  const dailyWageMinor = roundHalfUp(input.monthlySalaryMinor, input.wageBasisDays);
  const absenceMultiplier = input.options?.absenceMultiplier ?? { numerator: 1, denominator: 1 };
  const automaticAbsenceMinor = roundHalfUp(
    safeProduct(dailyWageMinor, absenceMultiplier.numerator),
    absenceMultiplier.denominator,
  );
  const cap =
    input.options?.capPerDateMinor === undefined ? dailyWageMinor : input.options.capPerDateMinor;
  const dates: PayrollDateResult[] = input.days.map((day) => {
    const treatment = day.deductionTreatment ?? 'automatic';
    const isAbsence = day.status === 'ABSENT';
    const billableLateMinutes =
      treatment === 'none' || treatment === 'full_day' || isAbsence
        ? 0
        : applyGrace(day.lateMinutes, input.options);
    const calculated =
      treatment === 'full_day' || (isAbsence && treatment === 'automatic')
        ? {
            units: 1,
            amountMinor:
              isAbsence && treatment === 'automatic' ? automaticAbsenceMinor : dailyWageMinor,
          }
        : treatment === 'none' || isAbsence
          ? { units: 0, amountMinor: 0 }
          : calculateDateAmount(
              input,
              billableLateMinutes,
              day.scheduledMinutes,
              treatment === 'hour_up' ? 'hour_up' : 'exact',
            );
    const amountMinor =
      isAbsence || cap === null ? calculated.amountMinor : Math.min(cap, calculated.amountMinor);
    return {
      date: day.date,
      status: day.status,
      actualLateMinutes: day.lateMinutes,
      billableLateMinutes,
      billableUnits: calculated.units,
      treatment,
      rule: treatment === 'full_day' ? 'manual_full_day' : input.policy.id,
      amountBeforeCapMinor: calculated.amountMinor,
      amountMinor,
      capApplied: amountMinor < calculated.amountMinor,
    };
  });

  const totalLateMinutes = input.days.reduce((total, day) => total + day.lateMinutes, 0);
  const latenessDeductionMinor = dates.reduce(
    (total, day) =>
      total +
      (input.days.find((inputDay) => inputDay.date === day.date)?.status === 'ABSENT'
        ? 0
        : day.amountMinor),
    0,
  );
  const absenceDays = input.days.filter((day) => day.status === 'ABSENT').length;
  const chargedAbsenceDays = dates.filter(
    (day) =>
      input.days.find((inputDay) => inputDay.date === day.date)?.status === 'ABSENT' &&
      day.amountMinor > 0,
  ).length;
  const absenceDeductionMinor = dates.reduce(
    (total, day) =>
      total +
      (input.days.find((inputDay) => inputDay.date === day.date)?.status === 'ABSENT'
        ? day.amountMinor
        : 0),
    0,
  );
  const otherApprovedItemsMinor = input.options?.otherApprovedItemsMinor ?? 0;
  const totalDeductionsMinor =
    latenessDeductionMinor + absenceDeductionMinor + otherApprovedItemsMinor;
  const netPayMinor = input.monthlySalaryMinor - totalDeductionsMinor;

  return {
    ok: true,
    value: {
      monthlySalaryMinor: input.monthlySalaryMinor,
      dailyWageMinor,
      totalLateMinutes,
      latenessDeductionMinor,
      absenceDays,
      chargedAbsenceDays,
      absenceDeductionMinor,
      otherApprovedItemsMinor,
      totalDeductionsMinor,
      netPayMinor,
      warnings: netPayMinor < 0 ? ['NEGATIVE_NET_PAY'] : [],
      dates,
    },
  };
};

const v2LateAmount = (
  input: PayrollV2Input,
  method: PayrollV2LateMethod,
  lateMinutes: number,
  customAmountMinor: number | undefined,
  dailyWageMinor: number,
): number => {
  const rule = input.lateRule;
  if (lateMinutes <= rule.graceMinutes || method === 'none') return 0;
  let amount = 0;
  switch (method) {
    case 'minutes':
      amount = roundHalfUp(safeProduct(rule.hourlyAmountMinor, lateMinutes), 60);
      break;
    case 'hours':
      amount =
        lateMinutes < rule.hourThresholdMinutes
          ? rule.shortLatenessAmountMinor
          : safeProduct(Math.ceil(lateMinutes / 60), rule.hourlyAmountMinor);
      break;
    case 'full_day_any':
      amount = dailyWageMinor;
      break;
    case 'full_day_threshold':
      amount = lateMinutes >= rule.fullDayThresholdMinutes ? dailyWageMinor : 0;
      break;
    case 'custom_amount':
      amount = customAmountMinor ?? 0;
      break;
  }
  return rule.capPerDayMinor === null ? amount : Math.min(amount, rule.capPerDayMinor);
};

const countedOvertime = (
  minutes: number,
  rounding: PayrollV2Input['overtimeRule']['rounding'],
): number => {
  if (rounding === 'down_30') return Math.floor(minutes / 30) * 30;
  if (rounding === 'down_60') return Math.floor(minutes / 60) * 60;
  return minutes;
};

export const calculatePayrollV2 = (
  input: PayrollV2Input,
): Result<PayrollV2Result, readonly PayrollError[]> => {
  const errors: PayrollError[] = [];
  if (!isNonNegativeInteger(input.monthlySalaryMinor))
    errors.push({ code: 'INVALID_MONTHLY_SALARY' });
  if (!isPositiveInteger(input.wageBasisDays)) errors.push({ code: 'INVALID_WAGE_BASIS' });
  const lateNumbers = [
    input.lateRule.hourlyAmountMinor,
    input.lateRule.hourThresholdMinutes,
    input.lateRule.shortLatenessAmountMinor,
    input.lateRule.fullDayThresholdMinutes,
    input.lateRule.graceMinutes,
  ];
  if (
    lateNumbers.some((value) => !isNonNegativeInteger(value)) ||
    (input.lateRule.capPerDayMinor !== null && !isNonNegativeInteger(input.lateRule.capPerDayMinor))
  )
    errors.push({ code: 'INVALID_LATE_RULE' });
  if (
    !isNonNegativeInteger(input.overtimeRule.amountPerHourMinor) ||
    !isNonNegativeInteger(input.overtimeRule.minimumMinutes) ||
    !isPositiveInteger(input.overtimeRule.hoursPerExtraDay)
  )
    errors.push({ code: 'INVALID_OVERTIME_RULE' });
  if (
    !isNonNegativeInteger(input.absenceMultiplier.numerator) ||
    !isPositiveInteger(input.absenceMultiplier.denominator)
  )
    errors.push({ code: 'INVALID_ABSENCE_MULTIPLIER' });
  const dates = new Set<string>();
  for (const day of input.days) {
    if (dates.has(day.date)) errors.push({ code: 'DUPLICATE_DATE', date: day.date });
    dates.add(day.date);
    if (!isNonNegativeInteger(day.lateMinutes))
      errors.push({ code: 'INVALID_LATE_MINUTES', date: day.date });
    if (!isNonNegativeInteger(day.overtimeMinutes))
      errors.push({ code: 'INVALID_OVERTIME_MINUTES', date: day.date });
    if (day.lateOverride?.method === 'custom_amount') {
      if (!isNonNegativeInteger(day.lateOverride.customAmountMinor ?? -1))
        errors.push({ code: 'INVALID_CUSTOM_AMOUNT', date: day.date });
      if (!day.lateOverride.reason?.trim())
        errors.push({ code: 'REASON_REQUIRED', date: day.date });
    }
    if (day.overtimeOverride?.method === 'custom_amount') {
      if (!isNonNegativeInteger(day.overtimeOverride.customAmountMinor ?? -1))
        errors.push({ code: 'INVALID_CUSTOM_AMOUNT', date: day.date });
      if (!day.overtimeOverride.reason?.trim())
        errors.push({ code: 'REASON_REQUIRED', date: day.date });
    }
  }
  if (errors.length) return { ok: false, error: errors };

  const dailyWageMinor = roundHalfUp(input.monthlySalaryMinor, input.wageBasisDays);
  const datesResult = input.days.map((day) => {
    const inert = day.status === 'REST' || day.status === 'PENDING_IMPORT';
    const included = (day.included ?? true) && !inert;
    const isAbsent = day.status === 'ABSENT';
    const method = day.lateOverride?.method ?? input.lateRule.method;
    const overtimeMethod = day.overtimeOverride?.method ?? input.overtimeRule.method;
    const deductionMinor =
      included && !isAbsent
        ? v2LateAmount(
            input,
            method,
            day.lateMinutes,
            day.lateOverride?.customAmountMinor,
            dailyWageMinor,
          )
        : 0;
    const absenceMinor =
      included && isAbsent
        ? roundHalfUp(
            safeProduct(dailyWageMinor, input.absenceMultiplier.numerator),
            input.absenceMultiplier.denominator,
          )
        : 0;
    const overtimeEligible = day.overtimeMinutes >= input.overtimeRule.minimumMinutes;
    const counted =
      included && !isAbsent && overtimeEligible && overtimeMethod !== 'none'
        ? countedOvertime(day.overtimeMinutes, input.overtimeRule.rounding)
        : 0;
    const bonusMinor =
      overtimeMethod === 'fixed_per_hour'
        ? roundHalfUp(safeProduct(input.overtimeRule.amountPerHourMinor, counted), 60)
        : overtimeMethod === 'extra_days'
          ? roundHalfUp(
              safeProduct(dailyWageMinor, counted),
              safeProduct(input.overtimeRule.hoursPerExtraDay, 60),
            )
          : overtimeMethod === 'custom_amount'
            ? (day.overtimeOverride?.customAmountMinor ?? 0)
            : 0;
    return {
      date: day.date,
      status: day.status,
      lateMinutes: day.lateMinutes,
      overtimeMinutes: day.overtimeMinutes,
      countedOvertimeMinutes: counted,
      included,
      method,
      overtimeMethod,
      deductionMinor,
      bonusMinor,
      absenceMinor,
      edited: Boolean(day.edited || day.lateOverride || day.overtimeOverride),
      reason: day.lateOverride?.reason ?? day.overtimeOverride?.reason ?? day.editReason ?? null,
    };
  });
  const latenessDeductionMinor = datesResult.reduce((sum, day) => sum + day.deductionMinor, 0);
  const absenceDeductionMinor = datesResult.reduce((sum, day) => sum + day.absenceMinor, 0);
  const overtimeBonusMinor = datesResult.reduce((sum, day) => sum + day.bonusMinor, 0);
  const otherApprovedDeductionsMinor = input.otherApprovedDeductionsMinor ?? 0;
  const finalSalaryMinor =
    input.monthlySalaryMinor -
    latenessDeductionMinor -
    absenceDeductionMinor -
    otherApprovedDeductionsMinor +
    overtimeBonusMinor;
  return {
    ok: true,
    value: {
      monthlySalaryMinor: input.monthlySalaryMinor,
      dailyWageMinor,
      // EARLY_LEAVE is a complete worked day; early-leave minutes are shown, not charged.
      presentDays: input.days.filter(
        (day) => day.status === 'PRESENT' || day.status === 'EARLY_LEAVE',
      ).length,
      absenceDays: input.days.filter((day) => day.status === 'ABSENT').length,
      totalLateMinutes: input.days.reduce((sum, day) => sum + day.lateMinutes, 0),
      totalOvertimeMinutes: input.days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
      countedOvertimeMinutes: datesResult.reduce((sum, day) => sum + day.countedOvertimeMinutes, 0),
      latenessDeductionMinor,
      absenceDeductionMinor,
      overtimeBonusMinor,
      otherApprovedDeductionsMinor,
      finalSalaryMinor,
      warnings: finalSalaryMinor < 0 ? ['NEGATIVE_NET_PAY'] : [],
      dates: datesResult,
    },
  };
};
