import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  calculatePayroll,
  calculatePayrollV2,
  roundHalfUp,
  validatePayrollInput,
} from '../src/index.js';
import type { PayrollDayInput, PayrollInput, PayrollPolicy } from '../src/index.js';
import fixtureData from './fixtures/payroll.json' with { type: 'json' };

interface PayrollFixture {
  dailyWageMinor: number;
  monthlySalaryMinor: number;
  wageBasisDays: number;
  scheduledMinutes: number;
  lateMinutes: number[];
  expected: Record<string, number[]>;
}

const fixture = fixtureData as PayrollFixture;

const daysFor = (lateMinutes: readonly number[]): PayrollDayInput[] =>
  lateMinutes.map((minutes, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, '0')}`,
    status: 'PRESENT',
    lateMinutes: minutes,
    scheduledMinutes: fixture.scheduledMinutes,
  }));

const inputFor = (
  policy: PayrollPolicy,
  lateMinutes: readonly number[] = fixture.lateMinutes,
  overrides: Partial<PayrollInput> = {},
): PayrollInput => ({
  monthlySalaryMinor: fixture.monthlySalaryMinor,
  wageBasisDays: fixture.wageBasisDays,
  days: daysFor(lateMinutes),
  policy,
  ...overrides,
});

describe('payroll calculation', () => {
  const vectorPolicies: Array<{ policy: PayrollPolicy; expectedKey: string }> = [
    { policy: { id: 'hourly_proportional' }, expectedKey: 'hourly_proportional' },
    { policy: { id: 'hourly_rounded_up' }, expectedKey: 'hourly_rounded_up' },
    { policy: { id: 'day_per_started_hour' }, expectedKey: 'day_per_started_hour' },
    { policy: { id: 'day_any_lateness' }, expectedKey: 'day_any_lateness' },
    {
      policy: { id: 'day_at_threshold', thresholdMinutes: 60 },
      expectedKey: 'day_at_threshold',
    },
  ];

  it('supports the no-deduction policy while preserving actual lateness', () => {
    const result = calculatePayroll(inputFor({ id: 'none' }, [30, 60]));
    expect(result).toMatchObject({
      ok: true,
      value: { totalLateMinutes: 90, latenessDeductionMinor: 0 },
    });
  });

  it('supports a fixed amount per late hour and preserves per-date distribution', () => {
    const result = calculatePayroll({
      ...inputFor({ id: 'fixed_hourly_amount', amountMinor: 10_000 }, [180, 60, 0]),
      options: { capPerDateMinor: null },
    });
    expect(result.ok && result.value).toMatchObject({
      totalLateMinutes: 240,
      latenessDeductionMinor: 40_000,
      dates: [
        { billableUnits: 3, amountMinor: 30_000 },
        { billableUnits: 1, amountMinor: 10_000 },
        { billableUnits: 0, amountMinor: 0 },
      ],
    });
  });

  it('rounds each partial late hour up when using a custom hourly amount', () => {
    const result = calculatePayroll({
      ...inputFor({ id: 'fixed_hourly_rounded_up', amountMinor: 10_000 }, [15, 60, 61, 0]),
      options: { capPerDateMinor: null },
    });
    expect(result.ok && result.value.dates.map((day) => day.amountMinor)).toEqual([
      10_000, 10_000, 20_000, 0,
    ]);
  });

  it('supports an audited per-date choice between exact and rounded late hours', () => {
    const days = daysFor([30, 30]).map((day, index) => ({
      ...day,
      deductionTreatment: index === 0 ? ('exact' as const) : ('hour_up' as const),
    }));
    const result = calculatePayroll({
      ...inputFor({ id: 'fixed_hourly_amount', amountMinor: 10_000 }),
      days,
      options: { capPerDateMinor: null },
    });
    expect(result.ok && result.value.dates).toMatchObject([
      { billableUnits: 0.5, amountMinor: 5_000 },
      { billableUnits: 1, amountMinor: 10_000 },
    ]);
  });

  it('deducts one day per date reaching 60 minutes, not one day per late hour', () => {
    const result = calculatePayroll(
      inputFor({ id: 'day_at_threshold', thresholdMinutes: 60 }, [180, 60, 59]),
    );
    expect(result.ok && result.value.dates.map((day) => day.amountMinor)).toEqual([
      20_000, 20_000, 0,
    ]);
  });

  it.each(vectorPolicies)('passes the $expectedKey vectors', ({ policy, expectedKey }) => {
    const result = calculatePayroll(inputFor(policy));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dailyWageMinor).toBe(fixture.dailyWageMinor);
      expect(result.value.dates.map((day) => day.amountMinor)).toEqual(
        fixture.expected[expectedKey],
      );
    }
  });

  it('keeps per-date rounding independent', () => {
    const rounded = calculatePayroll(inputFor({ id: 'hourly_rounded_up' }, [30, 30]));
    const proportional = calculatePayroll(inputFor({ id: 'hourly_proportional' }, [30, 30]));
    expect(rounded.ok && rounded.value.latenessDeductionMinor).toBe(3334);
    expect(proportional.ok && proportional.value.latenessDeductionMinor).toBe(1666);
    expect(proportional.ok && proportional.value.totalLateMinutes).toBe(60);
  });

  it('supports both grace modes without changing actual late minutes', () => {
    const threshold = calculatePayroll({
      ...inputFor({ id: 'hourly_proportional' }, [10, 20]),
      options: { graceMinutes: 15, graceMode: 'threshold' },
    });
    const subtract = calculatePayroll({
      ...inputFor({ id: 'hourly_proportional' }, [20]),
      options: { graceMinutes: 15, graceMode: 'subtract' },
    });
    expect(threshold.ok && threshold.value.dates.map((day) => day.billableLateMinutes)).toEqual([
      0, 20,
    ]);
    expect(threshold.ok && threshold.value.totalLateMinutes).toBe(30);
    expect(subtract.ok && subtract.value.dates[0]?.billableLateMinutes).toBe(5);
  });

  it('applies the default daily cap and supports no cap', () => {
    const capped = calculatePayroll(inputFor({ id: 'day_per_started_hour' }, [61]));
    const uncapped = calculatePayroll({
      ...inputFor({ id: 'day_per_started_hour' }, [61]),
      options: { capPerDateMinor: null },
    });
    expect(capped.ok && capped.value.dates[0]).toMatchObject({
      amountMinor: 20000,
      amountBeforeCapMinor: 40000,
      capApplied: true,
    });
    expect(uncapped.ok && uncapped.value.dates[0]).toMatchObject({
      amountMinor: 40000,
      capApplied: false,
    });
  });

  it('supports a fixed hourly basis and non-30-day wage basis', () => {
    const result = calculatePayroll({
      ...inputFor({ id: 'hourly_proportional' }, [60]),
      wageBasisDays: 26,
      options: { hourlyBasis: { kind: 'fixed', minutes: 480 } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dailyWageMinor).toBe(23077);
      expect(result.value.dates[0]?.amountMinor).toBe(2885);
    }
  });

  it('calculates absence separately and warns instead of clamping negative net pay', () => {
    const result = calculatePayroll({
      monthlySalaryMinor: 10000,
      wageBasisDays: 1,
      policy: { id: 'day_any_lateness' },
      days: [
        {
          date: '2026-11-01',
          status: 'ABSENT',
          lateMinutes: 1,
          scheduledMinutes: 480,
        },
      ],
      options: {
        absenceMultiplier: { numerator: 3, denominator: 2 },
        otherApprovedItemsMinor: 1000,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.latenessDeductionMinor).toBe(0);
      expect(result.value.absenceDeductionMinor).toBe(15000);
      expect(result.value.netPayMinor).toBe(-6000);
      expect(result.value.warnings).toContain('NEGATIVE_NET_PAY');
    }
  });

  it('starts reviewed dates with no deduction and supports explicit per-date choices', () => {
    const result = calculatePayroll({
      ...inputFor({ id: 'fixed_hourly_amount', amountMinor: 10_000 }, [30, 30, 0]),
      days: [
        { ...daysFor([30])[0]!, deductionTreatment: 'none' },
        { ...daysFor([30])[0]!, date: '2026-11-02', deductionTreatment: 'hour_up' },
        {
          ...daysFor([0])[0]!,
          date: '2026-11-03',
          status: 'ABSENT',
          deductionTreatment: 'full_day',
        },
      ],
    });
    expect(result.ok && result.value).toMatchObject({
      latenessDeductionMinor: 10_000,
      absenceDays: 1,
      chargedAbsenceDays: 1,
      absenceDeductionMinor: 20_000,
      totalDeductionsMinor: 30_000,
    });
  });

  it('selects non-overlapping custom tiers with fixed and rational amounts', () => {
    const policy: PayrollPolicy = {
      id: 'custom_tiers',
      tiers: [
        { fromMin: 1, toMin: 30, amountMinor: 500 },
        {
          fromMin: 31,
          toMin: null,
          fractionOfDaily: { numerator: 1, denominator: 2 },
        },
      ],
    };
    const result = calculatePayroll(inputFor(policy, [0, 20, 40]));
    expect(result.ok && result.value.dates.map((day) => day.amountMinor)).toEqual([0, 500, 10000]);
    const overlapping = validatePayrollInput(
      inputFor(
        {
          id: 'custom_tiers',
          tiers: [
            { fromMin: 1, toMin: 30, amountMinor: 100 },
            { fromMin: 30, toMin: 60, amountMinor: 200 },
          ],
        },
        [10],
      ),
    );
    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok) {
      expect(overlapping.error.some((error) => error.code === 'OVERLAPPING_TIERS')).toBe(true);
    }
  });

  it('rounds exact halves away from zero', () => {
    expect(roundHalfUp(1, 2)).toBe(1);
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(-5, 2)).toBe(-3);
  });

  it('reports invalid policy inputs as typed errors', () => {
    const invalid: PayrollInput = {
      monthlySalaryMinor: -1,
      wageBasisDays: 0,
      policy: { id: 'day_at_threshold', thresholdMinutes: -1 },
      days: [
        { date: '2026-11-01', status: 'PRESENT', lateMinutes: -1 },
        { date: '2026-11-01', status: 'PRESENT', lateMinutes: 1 },
      ],
      options: {
        graceMinutes: -1,
        capPerDateMinor: -1,
        absenceMultiplier: { numerator: 1, denominator: 0 },
        otherApprovedItemsMinor: -1,
      },
    };
    const result = validatePayrollInput(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((error) => error.code)).toEqual(
        expect.arrayContaining([
          'INVALID_MONTHLY_SALARY',
          'INVALID_WAGE_BASIS',
          'INVALID_LATE_MINUTES',
          'DUPLICATE_DATE',
          'INVALID_GRACE',
          'INVALID_CAP',
          'INVALID_ABSENCE_MULTIPLIER',
          'INVALID_OTHER_ITEMS',
          'INVALID_THRESHOLD',
        ]),
      );
    }
  });

  it('always totals dates and actual minutes as the sum of daily results', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 600 }), { minLength: 1, maxLength: 28 }),
        (lateMinutes) => {
          const result = calculatePayroll(inputFor({ id: 'hourly_proportional' }, lateMinutes));
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.totalLateMinutes).toBe(
              lateMinutes.reduce((total, minutes) => total + minutes, 0),
            );
            expect(result.value.latenessDeductionMinor).toBe(
              result.value.dates.reduce((total, day) => total + day.amountMinor, 0),
            );
          }
        },
      ),
    );
  });
});

describe('payroll v2 month rules', () => {
  const base = {
    monthlySalaryMinor: 600_000,
    wageBasisDays: 30,
    lateRule: {
      method: 'hours' as const,
      hourlyAmountMinor: 10_000,
      hourThresholdMinutes: 30,
      shortLatenessAmountMinor: 2_500,
      fullDayThresholdMinutes: 60,
      graceMinutes: 0,
      capPerDayMinor: null,
    },
    overtimeRule: {
      method: 'fixed_per_hour' as const,
      amountPerHourMinor: 6_000,
      minimumMinutes: 15,
      rounding: 'exact' as const,
      hoursPerExtraDay: 12,
    },
    absenceMultiplier: { numerator: 1, denominator: 1 },
  };

  const v2Days = (late: readonly number[], overtime: readonly number[] = []) =>
    late.map((lateMinutes, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      status: 'PRESENT' as const,
      lateMinutes,
      overtimeMinutes: overtime[index] ?? 0,
      scheduledMinutes: 720,
    }));

  it('passes the approved lateness vectors and rounds every date independently', () => {
    const result = calculatePayrollV2({
      ...base,
      days: v2Days([0, 25, 29, 30, 35, 60, 61, 130]),
    });
    expect(result.ok && result.value.dates.map((day) => day.deductionMinor)).toEqual([
      0, 2_500, 2_500, 10_000, 10_000, 10_000, 20_000, 30_000,
    ]);
    expect(result.ok && result.value.latenessDeductionMinor).toBe(85_000);
  });

  it('supports minute, full-day, custom, and per-date override rules', () => {
    const result = calculatePayrollV2({
      ...base,
      lateRule: { ...base.lateRule, method: 'minutes' as const },
      days: [
        ...v2Days([30]),
        {
          ...v2Days([1])[0]!,
          date: '2026-11-02',
          lateOverride: { method: 'full_day_any' as const, reason: 'Manager decision' },
        },
        {
          ...v2Days([5])[0]!,
          date: '2026-11-03',
          lateOverride: {
            method: 'custom_amount' as const,
            customAmountMinor: 1_234,
            reason: 'Documented adjustment',
          },
        },
      ],
    });
    expect(result.ok && result.value.dates.map((day) => day.deductionMinor)).toEqual([
      5_000, 20_000, 1_234,
    ]);
    expect(result.ok && result.value.dates.map((day) => day.method)).toEqual([
      'minutes',
      'full_day_any',
      'custom_amount',
    ]);
  });

  it('charges full-day lateness per affected date, not from the monthly minute total', () => {
    const result = calculatePayrollV2({
      ...base,
      lateRule: { ...base.lateRule, method: 'full_day_any' as const },
      days: v2Days([10, 11, 12, 13, 14, 9]),
    });
    expect(result.ok && result.value.totalLateMinutes).toBe(69);
    expect(result.ok && result.value.dailyWageMinor).toBe(20_000);
    expect(result.ok && result.value.dates.map((day) => day.deductionMinor)).toEqual([
      20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
    ]);
    expect(result.ok && result.value.latenessDeductionMinor).toBe(120_000);
  });

  it('calculates fixed and extra-day overtime bonuses with minimum and rounding', () => {
    const fixed = calculatePayrollV2({ ...base, days: v2Days([0, 0, 0], [14, 49, 71]) });
    expect(fixed.ok && fixed.value.dates.map((day) => day.bonusMinor)).toEqual([0, 4_900, 7_100]);
    const extra = calculatePayrollV2({
      ...base,
      overtimeRule: { ...base.overtimeRule, method: 'extra_days' as const },
      days: v2Days([0], [360]),
    });
    expect(extra.ok && extra.value.dates[0]?.bonusMinor).toBe(10_000);
  });

  it('uses shared prices for day overrides and recalculates totals from visible rows', () => {
    const input = {
      ...base,
      lateRule: { ...base.lateRule, method: 'none' as const, hourlyAmountMinor: 10_000 },
      days: [
        {
          ...v2Days([30], [60])[0]!,
          lateOverride: { method: 'minutes' as const, reason: 'Use exact minutes' },
          overtimeOverride: { method: 'fixed_per_hour' as const },
        },
        {
          ...v2Days([61], [360])[0]!,
          date: '2026-11-02',
          lateOverride: { method: 'hours' as const },
          overtimeOverride: { method: 'extra_days' as const },
        },
      ],
    };
    const first = calculatePayrollV2(input);
    expect(first.ok && first.value.dates.map((day) => day.deductionMinor)).toEqual([5_000, 20_000]);
    expect(first.ok && first.value.dates.map((day) => day.bonusMinor)).toEqual([6_000, 10_000]);
    if (first.ok) {
      expect(first.value.latenessDeductionMinor).toBe(
        first.value.dates.reduce((total, day) => total + day.deductionMinor, 0),
      );
      expect(first.value.overtimeBonusMinor).toBe(
        first.value.dates.reduce((total, day) => total + day.bonusMinor, 0),
      );
    }

    const repriced = calculatePayrollV2({
      ...input,
      lateRule: { ...input.lateRule, hourlyAmountMinor: 12_000 },
    });
    expect(repriced.ok && repriced.value.dates.map((day) => day.deductionMinor)).toEqual([
      6_000, 24_000,
    ]);
  });

  it('supports an audited custom overtime bonus and rejects it without a reason', () => {
    const valid = calculatePayrollV2({
      ...base,
      days: [
        {
          ...v2Days([0], [30])[0]!,
          overtimeOverride: {
            method: 'custom_amount' as const,
            customAmountMinor: 1_750,
            reason: 'Approved event bonus',
          },
        },
      ],
    });
    expect(valid.ok && valid.value.dates[0]?.bonusMinor).toBe(1_750);
    const invalid = calculatePayrollV2({
      ...base,
      days: [
        {
          ...v2Days([0], [30])[0]!,
          overtimeOverride: {
            method: 'custom_amount' as const,
            customAmountMinor: 1_750,
          },
        },
      ],
    });
    expect(invalid).toMatchObject({ ok: false, error: [{ code: 'REASON_REQUIRED' }] });
  });

  it('keeps absence separate and excludes unticked rows from totals', () => {
    const result = calculatePayrollV2({
      ...base,
      days: [
        { ...v2Days([30], [60])[0]!, included: false },
        {
          ...v2Days([0])[0]!,
          date: '2026-11-02',
          status: 'ABSENT' as const,
          overtimeMinutes: 0,
        },
      ],
    });
    expect(result.ok && result.value).toMatchObject({
      latenessDeductionMinor: 0,
      absenceDeductionMinor: 20_000,
      overtimeBonusMinor: 0,
      finalSalaryMinor: 580_000,
    });
  });

  it('treats EARLY_LEAVE as worked, REVIEW as flagged-not-absent, and nets equal per-day sums', () => {
    const input = {
      ...base,
      lateRule: { ...base.lateRule, method: 'minutes' as const },
      days: [
        { ...v2Days([30], [60])[0]!, status: 'EARLY_LEAVE' as const },
        { ...v2Days([0])[0]!, date: '2026-11-02', status: 'REVIEW' as const },
        { ...v2Days([0])[0]!, date: '2026-11-03', status: 'ABSENT' as const },
        { ...v2Days([0])[0]!, date: '2026-11-04', status: 'REST' as const },
        {
          ...v2Days([61], [120])[0]!,
          date: '2026-11-05',
          lateOverride: { method: 'hours' as const },
          overtimeOverride: { method: 'extra_days' as const },
        },
      ],
    };
    const result = calculatePayrollV2(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.presentDays).toBe(2);
    expect(result.value.absenceDays).toBe(1);
    expect(result.value.dates.map((day) => day.absenceMinor)).toEqual([0, 0, 20_000, 0, 0]);
    expect(result.value.dates[1]).toMatchObject({ deductionMinor: 0, bonusMinor: 0 });
    expect(result.value.dates[3]).toMatchObject({ included: false, deductionMinor: 0 });
    const perDayNet = result.value.dates.reduce(
      (total, day) => total + day.bonusMinor - day.deductionMinor - day.absenceMinor,
      0,
    );
    expect(result.value.finalSalaryMinor).toBe(base.monthlySalaryMinor + perDayNet);

    const repriced = calculatePayrollV2({
      ...input,
      lateRule: { ...input.lateRule, hourlyAmountMinor: 6_000 },
      overtimeRule: { ...input.overtimeRule, amountPerHourMinor: 9_000, hoursPerExtraDay: 8 },
    });
    expect(repriced.ok && repriced.value.dates.map((day) => day.deductionMinor)).toEqual([
      3_000, 0, 0, 0, 12_000,
    ]);
    expect(repriced.ok && repriced.value.dates.map((day) => day.bonusMinor)).toEqual([
      9_000, 0, 0, 0, 5_000,
    ]);
  });

  it('rejects unaudited custom amounts and warns without clamping negative salary', () => {
    const invalid = calculatePayrollV2({
      ...base,
      monthlySalaryMinor: 1_000,
      days: [
        {
          ...v2Days([1])[0]!,
          lateOverride: { method: 'custom_amount' as const, customAmountMinor: 10_000 },
        },
      ],
    });
    expect(invalid).toMatchObject({ ok: false, error: [{ code: 'REASON_REQUIRED' }] });
    const negative = calculatePayrollV2({
      ...base,
      monthlySalaryMinor: 1_000,
      wageBasisDays: 1,
      lateRule: { ...base.lateRule, capPerDayMinor: null },
      days: v2Days([130]),
    });
    expect(negative.ok && negative.value.finalSalaryMinor).toBe(-29_000);
    expect(negative.ok && negative.value.warnings).toContain('NEGATIVE_NET_PAY');
  });
});
