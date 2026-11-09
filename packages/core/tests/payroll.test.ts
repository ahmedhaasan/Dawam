import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { calculatePayroll, roundHalfUp, validatePayrollInput } from '../src/index.js';
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
      lateRounding: index === 0 ? ('exact' as const) : ('hour_up' as const),
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
      expect(result.value.latenessDeductionMinor).toBe(10000);
      expect(result.value.absenceDeductionMinor).toBe(15000);
      expect(result.value.netPayMinor).toBe(-16000);
      expect(result.value.warnings).toContain('NEGATIVE_NET_PAY');
    }
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
