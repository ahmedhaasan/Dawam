import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AttendanceDayDto,
  EmployeeDto,
  PayrollDateResultDto,
  PayrollPolicyConfigDto,
  PayrollPolicyDto,
  PayrollPreviewDto,
  PayrollRunDto,
} from '../../shared/ipc';
import { PayrollRulesDialog } from './PayrollRulesDialog';
import { useStickyOffsets } from './useStickyOffsets';
import {
  configToDraft,
  DAY_LATE_METHODS,
  DAY_OVERTIME_METHODS,
  DEFAULT_RULES,
  draftToConfig,
  explainLate,
  explainOvertime,
  type LateMethod,
  type OvertimeMethod,
  type RuleDraft,
  wholeNumber,
} from './payroll-rules';

const cairoMonth = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);

interface Decision {
  included?: boolean;
  lateMethod?: LateMethod | undefined;
  overtimeMethod?: OvertimeMethod | undefined;
  lateCustomAmountMinor?: number;
  overtimeCustomAmountMinor?: number;
  lateReason?: string;
  overtimeReason?: string;
}
type Decisions = Record<string, Decision>;

const INERT_STATUSES = new Set(['REST', 'PENDING_IMPORT', 'ABSENT']);
const REVIEW_STATUSES = new Set(['REVIEW', 'MISSING_IN', 'MISSING_OUT']);
const REST_LIKE_STATUSES = new Set(['REST', 'LEAVE', 'PERMISSION', 'NO_SCHEDULE']);

const statusTone = (status: string): string => {
  if (status === 'PRESENT') return 'ok';
  if (status === 'ABSENT') return 'bad';
  if (REST_LIKE_STATUSES.has(status)) return 'rest';
  return 'warn';
};

const timePart = (value?: string): string => (value ? value.slice(11, 16) : '—');
const dayOffset = (value: string | undefined, date: string): number => {
  if (!value) return 0;
  const day = value.slice(0, 10);
  return day === date ? 0 : day > date ? 1 : -1;
};

/** A custom amount needs a reason before the service will accept the decision set. */
const incompleteCustom = (decision: Decision | undefined): boolean =>
  Boolean(
    decision &&
    ((decision.lateMethod === 'custom_amount' && !decision.lateReason?.trim()) ||
      (decision.overtimeMethod === 'custom_amount' && !decision.overtimeReason?.trim())),
  );

const cleanDecision = (decision: Decision): Decision | null => {
  const next: Decision = {};
  if (decision.included !== undefined) next.included = decision.included;
  if (decision.lateMethod) {
    next.lateMethod = decision.lateMethod;
    if (decision.lateMethod === 'custom_amount') {
      next.lateCustomAmountMinor = decision.lateCustomAmountMinor ?? 0;
      next.lateReason = decision.lateReason ?? '';
    }
  }
  if (decision.overtimeMethod) {
    next.overtimeMethod = decision.overtimeMethod;
    if (decision.overtimeMethod === 'custom_amount') {
      next.overtimeCustomAmountMinor = decision.overtimeCustomAmountMinor ?? 0;
      next.overtimeReason = decision.overtimeReason ?? '';
    }
  }
  return Object.keys(next).length ? next : null;
};

const egpInputToMinor = (value: string): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
};

export const PayrollScreen = ({ isAdmin }: { isAdmin: boolean }): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const isArabic = i18n.resolvedLanguage === 'ar';
  const locale = isArabic ? 'ar-EG-u-nu-latn' : 'en-EG';
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [ready, setReady] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(cairoMonth());
  const [rules, setRules] = useState<RuleDraft>(DEFAULT_RULES);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [salaryOverride, setSalaryOverride] = useState('');
  const [updateEmployeeSalary, setUpdateEmployeeSalary] = useState(false);
  const [preview, setPreview] = useState<PayrollPreviewDto | null>(null);
  const [attendanceDays, setAttendanceDays] = useState<ReadonlyMap<string, AttendanceDayDto>>(
    new Map(),
  );
  const [runs, setRuns] = useState<readonly PayrollRunDto[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const policiesRef = useRef<PayrollPolicyDto[]>([]);
  const requestRef = useRef(0);
  const screenRef = useStickyOffsets<HTMLElement>();
  const timerRef = useRef<number | undefined>(undefined);
  const selectedEmployee = employees.find((employee) => String(employee.id) === employeeId);

  const moneyFormat = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EGP',
        maximumFractionDigits: 2,
      }),
    [locale],
  );
  const money = useCallback((minor = 0): string => moneyFormat.format(minor / 100), [moneyFormat]);
  const signed = (minor: number): string =>
    minor === 0 ? money(0) : `${minor < 0 ? '−' : '+'} ${money(Math.abs(minor))}`;
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  );

  const capPerDayMinor =
    selectedEmployee?.monthlySalaryMinor == null
      ? 0
      : Math.round(selectedEmployee.monthlySalaryMinor / (selectedEmployee.wageBasisDays ?? 30));

  const findPolicy = async (config: PayrollPolicyConfigDto): Promise<number | null> => {
    if (!window.dawam) return null;
    const serialized = JSON.stringify(config);
    const existing = policiesRef.current.find(
      (policy) => JSON.stringify(policy.config) === serialized,
    );
    if (existing) return existing.id;
    const response = await window.dawam.payroll.createPolicy({
      name: `Payroll v2 · ${month}`,
      config,
      reason: 'Payroll v2 month rules',
    });
    if (!response.ok) {
      setMessage(t(response.error.messageKey));
      return null;
    }
    policiesRef.current = [...policiesRef.current, response.value];
    return response.value.id;
  };

  const calculate = async (
    options: { next?: Decisions; salary?: string; draft?: RuleDraft; announce?: boolean } = {},
  ): Promise<void> => {
    const next = options.next ?? decisions;
    const salary = options.salary ?? salaryOverride;
    const draft = options.draft ?? rules;
    if (!window.dawam || !employeeId) return;
    if (Object.values(next).some(incompleteCustom)) return;
    const ticket = ++requestRef.current;
    setLoading(true);
    const policyId = await findPolicy(draftToConfig(draft, capPerDayMinor));
    if (!policyId) {
      if (ticket === requestRef.current) setLoading(false);
      return;
    }
    const [response, attendance] = await Promise.all([
      window.dawam.payroll.preview({
        employeeId: Number(employeeId),
        month,
        policyId,
        dateDecisions: next,
        ...(salary ? { salaryOverrideMinor: egpInputToMinor(salary) } : {}),
      }),
      window.dawam.attendance.month({ employeeId: Number(employeeId), month }),
    ]);
    if (ticket !== requestRef.current) return;
    if (attendance.ok)
      setAttendanceDays(new Map(attendance.value.days.map((day) => [day.date, day])));
    if (response.ok) {
      setPreview(response.value);
      setMessage(options.announce ? t('payroll.board.refreshed') : '');
    } else {
      setPreview(null);
      setMessage(t(response.error.messageKey));
    }
    setLoading(false);
  };
  const calculateRef = useRef(calculate);
  calculateRef.current = calculate;

  const loadRuns = async (): Promise<void> => {
    if (!window.dawam || !employeeId) return;
    const response = await window.dawam.payroll.listRuns({ employeeId: Number(employeeId), month });
    if (response.ok) setRuns(response.value);
  };

  useEffect(() => {
    void (async () => {
      if (!window.dawam || !isAdmin) return;
      setLoading(true);
      const [people, savedPolicies] = await Promise.all([
        window.dawam.workforce.listEmployees(),
        window.dawam.payroll.listPolicies(),
      ]);
      if (people.ok) {
        const active = people.value.filter((employee) => employee.active);
        setEmployees(active);
        setEmployeeId((current) => current || String(active[0]?.id ?? ''));
      } else setMessage(t(people.error.messageKey));
      if (savedPolicies.ok) {
        policiesRef.current = [...savedPolicies.value];
        // The most recently saved v2 rules become the active rules on screen.
        const latest = [...savedPolicies.value]
          .reverse()
          .map((policy) => configToDraft(policy.config))
          .find((draft): draft is RuleDraft => draft !== null);
        if (latest) setRules(latest);
      }
      setLoading(false);
      setReady(true);
    })();
  }, [isAdmin]);

  // Attendance is re-read on every show, employee change, and month change so new
  // imports and corrections are always reflected.
  useEffect(() => {
    if (!ready || !employeeId) return;
    setDecisions({});
    setSalaryOverride('');
    setUpdateEmployeeSalary(false);
    setPreview(null);
    void calculateRef.current({ next: {}, salary: '' });
    void loadRuns();
  }, [ready, employeeId, month]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void calculateRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleCalculate = (next: Decisions, salary = salaryOverride): void => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void calculateRef.current({ next, salary }), 250);
  };

  const changeDecision = (date: string, patch: Partial<Decision>): void => {
    const merged = cleanDecision({ ...decisions[date], ...patch });
    const next = { ...decisions };
    if (merged) next[date] = merged;
    else delete next[date];
    setDecisions(next);
    scheduleCalculate(next);
  };

  const saveRules = (draft: RuleDraft): void => {
    setRules(draft);
    setRulesOpen(false);
    void calculate({ draft });
  };
  const resetEditedDays = (): void => {
    setDecisions({});
    void calculate({ next: {} });
  };
  const cancelRules = useCallback(() => setRulesOpen(false), []);

  const approve = async (): Promise<void> => {
    if (!window.dawam || !preview || !window.confirm(t('payroll.approveWarning'))) return;
    const response = await window.dawam.payroll.approve({
      employeeId: preview.employee.id,
      month: preview.month,
      policyId: preview.policy.id,
      dateDecisions: decisions,
      ...(salaryOverride ? { salaryOverrideMinor: egpInputToMinor(salaryOverride) } : {}),
      reason: `Payroll v2 approved for ${preview.month}`,
    });
    if (!response.ok) {
      setMessage(t(response.error.messageKey));
      return;
    }
    if (updateEmployeeSalary && salaryOverride && selectedEmployee) {
      const employeeUpdate = await window.dawam.workforce.updateEmployee({
        id: selectedEmployee.id,
        fullName: selectedEmployee.fullName,
        deviceUserId: selectedEmployee.deviceUserId,
        hireDate: selectedEmployee.hireDate,
        active: selectedEmployee.active,
        monthlySalaryMinor: egpInputToMinor(salaryOverride),
        wageBasisDays: selectedEmployee.wageBasisDays ?? 30,
        reason: `Salary updated during payroll approval for ${preview.month}`,
      });
      if (!employeeUpdate.ok) {
        setMessage(`${t('payroll.approved')} ${t(employeeUpdate.error.messageKey)}`);
        await loadRuns();
        return;
      }
      setEmployees((current) =>
        current.map((employee) =>
          employee.id === selectedEmployee.id
            ? { ...employee, monthlySalaryMinor: egpInputToMinor(salaryOverride) }
            : employee,
        ),
      );
    }
    setMessage(t('payroll.approved'));
    await loadRuns();
  };
  const voidRun = async (runId: number): Promise<void> => {
    if (!window.dawam) return;
    const response = await window.dawam.payroll.voidRun({ runId, reason: voidReason });
    if (response.ok) {
      setVoidReason('');
      setMessage(t('payroll.voided'));
      await loadRuns();
    } else setMessage(t(response.error.messageKey));
  };

  if (!isAdmin) return <section className="card empty-state">{t('payroll.adminOnly')}</section>;

  const result = preview?.result;
  const dates: readonly PayrollDateResultDto[] = result?.dates ?? [];
  const sum = (pick: (day: PayrollDateResultDto) => number): number =>
    dates.reduce((total, day) => total + pick(day), 0);
  // Custom amounts are shown on their own line; the regular lines exclude them so
  // every line plus the base salary adds up exactly to the net from the engine.
  const customLateMinor = sum((day) =>
    day.method === 'custom_amount' ? (day.deductionMinor ?? 0) : 0,
  );
  const customBonusMinor = sum((day) =>
    day.overtimeMethod === 'custom_amount' ? (day.bonusMinor ?? 0) : 0,
  );
  const customDays = dates.filter(
    (day) =>
      day.included !== false &&
      (day.method === 'custom_amount' || day.overtimeMethod === 'custom_amount'),
  ).length;
  const lateMinor = (result?.latenessDeductionMinor ?? 0) - customLateMinor;
  const bonusMinor = (result?.overtimeBonusMinor ?? 0) - customBonusMinor;
  const otherMinor =
    (result as { otherApprovedDeductionsMinor?: number } | undefined)
      ?.otherApprovedDeductionsMinor ?? 0;
  const countStatus = (statuses: ReadonlySet<string>): number =>
    dates.filter((day) => statuses.has(day.status)).length;
  const restDays = countStatus(new Set(['REST']));
  const earlyLeaveDays = countStatus(new Set(['EARLY_LEAVE']));
  const reviewDays = countStatus(REVIEW_STATUSES);
  const dailyWageMinor = result?.dailyWageMinor ?? capPerDayMinor;
  const chargedLateDates = dates.filter(
    (day) =>
      day.included !== false && day.method !== 'custom_amount' && (day.deductionMinor ?? 0) > 0,
  );
  const fullDayChargedDates = chargedLateDates.filter(
    (day) => day.method === 'full_day_any' || day.method === 'full_day_threshold',
  );
  const fullDayLateMinor = fullDayChargedDates.reduce(
    (total, day) => total + (day.deductionMinor ?? 0),
    0,
  );
  const editedDayCount = Object.values(decisions).filter(
    (decision) => decision.lateMethod || decision.overtimeMethod,
  ).length;
  const followingDayCount = Math.max(0, dates.length - editedDayCount);
  const alreadyApproved = runs.some((run) => run.status === 'approved');
  const finalSalaryMinor = result?.finalSalaryMinor ?? result?.netPayMinor ?? 0;

  return (
    <section ref={screenRef} className="module-screen payroll-board">
      <header className="pb-header">
        <div className="pb-title">
          <span className="pb-eyebrow">{t('payroll.eyebrow')}</span>
          <h1>{t('payroll.title')}</h1>
        </div>
        <div className="pb-controls">
          <label className="pb-field">
            <span>{t('employees.employee')}</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.deviceUserId}
                </option>
              ))}
            </select>
          </label>
          <label className="pb-field">
            <span>{t('attendance.month')}</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <button
            type="button"
            className="pb-icon-button"
            aria-label={t('payroll.board.refresh')}
            title={t('payroll.board.refresh')}
            disabled={loading || !employeeId}
            onClick={() => void calculate({ announce: true })}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="pb-button" onClick={() => setRulesOpen(true)}>
            {t('payroll.board.editRules')}
          </button>
        </div>
      </header>

      {message && (
        <div className="pb-message" role="status">
          {message}
        </div>
      )}

      <div className="pb-layout">
        <aside className="pb-summary" aria-busy={loading}>
          <div className="pb-net">
            <span>{t('payroll.board.netSalary')}</span>
            <strong>{money(finalSalaryMinor)}</strong>
          </div>
          {(result?.warnings.length ?? 0) > 0 && (
            <div className="pb-alert pb-alert--bad">{t('payroll.negativeNet')}</div>
          )}

          <section className="pb-card pb-card--breakdown">
            <h2>{t('payroll.board.breakdown')}</h2>
            <dl className="pb-breakdown">
              <div>
                <dt>{t('payroll.board.baseSalary')}</dt>
                <dd>
                  {money(result?.monthlySalaryMinor ?? selectedEmployee?.monthlySalaryMinor ?? 0)}
                </dd>
              </div>
              <div className="is-bad">
                <dt>{t('payroll.board.absenceLine', { count: result?.absenceDays ?? 0 })}</dt>
                <dd>{signed(-(result?.absenceDeductionMinor ?? 0))}</dd>
              </div>
              <div className="is-bad">
                <dt>
                  {t('payroll.board.lateLine', {
                    minutes: result?.totalLateMinutes ?? 0,
                    days: chargedLateDates.length,
                  })}
                  {fullDayChargedDates.length > 0 && (
                    <small className="pb-formula">
                      {t('payroll.board.fullDayFormula', {
                        count: fullDayChargedDates.length,
                        daily: money(dailyWageMinor),
                        total: money(fullDayLateMinor),
                      })}
                    </small>
                  )}
                </dt>
                <dd>{signed(-lateMinor)}</dd>
              </div>
              <div className="is-good">
                <dt>
                  {t('payroll.board.overtimeLine', {
                    minutes: result?.countedOvertimeMinutes ?? 0,
                  })}
                </dt>
                <dd>{signed(bonusMinor)}</dd>
              </div>
              <div className={customBonusMinor - customLateMinor < 0 ? 'is-bad' : 'is-good'}>
                <dt>{t('payroll.board.customLine', { count: customDays })}</dt>
                <dd>{signed(customBonusMinor - customLateMinor)}</dd>
              </div>
              {otherMinor > 0 && (
                <div className="is-bad">
                  <dt>{t('payroll.board.otherLine')}</dt>
                  <dd>{signed(-otherMinor)}</dd>
                </div>
              )}
              <div className="pb-breakdown-total">
                <dt>{t('payroll.board.netLine')}</dt>
                <dd>{money(finalSalaryMinor)}</dd>
              </div>
            </dl>
            <p className="pb-muted">
              {t('payroll.board.dailyWage')}: <b>{money(dailyWageMinor)}</b>
            </p>
          </section>

          <section className="pb-card pb-card--counters">
            <h2>{t('payroll.board.counters')}</h2>
            <div className="pb-counters">
              <Counter
                label={t('payroll.board.present')}
                value={result?.presentDays ?? 0}
                tone="ok"
              />
              <Counter
                label={t('payroll.board.absent')}
                value={result?.absenceDays ?? 0}
                tone="bad"
              />
              <Counter label={t('payroll.board.rest')} value={restDays} tone="rest" />
              <Counter label={t('payroll.board.earlyLeave')} value={earlyLeaveDays} tone="warn" />
              <Counter label={t('payroll.board.review')} value={reviewDays} tone="warn" />
              <Counter
                label={t('payroll.board.lateMinutes')}
                value={result?.totalLateMinutes ?? 0}
                tone="warn"
              />
              <Counter
                label={t('payroll.board.overtimeMinutes')}
                value={result?.countedOvertimeMinutes ?? 0}
                tone="ok"
              />
            </div>
            {reviewDays > 0 && (
              <div className="pb-alert pb-alert--warn">
                {t('payroll.board.reviewWarning', { count: reviewDays })}
              </div>
            )}
          </section>

          <section className="pb-card pb-active-rules">
            <h2>{t('payroll.board.activeRules')}</h2>
            <div className="pb-rule">
              <span className="pb-rule-label">{t('payroll.board.lateRuleLabel')}</span>
              <strong>{t(`payroll.lateMethods.${rules.lateMethod}`)}</strong>
              <small>{explainLate(t, rules.lateMethod, rules, money, dailyWageMinor)}</small>
              <span className="pb-chip pb-chip--rest">
                {t('payroll.board.graceLabel', { minutes: wholeNumber(rules.grace) })}
              </span>
            </div>
            <div className="pb-rule">
              <span className="pb-rule-label">{t('payroll.board.overtimeRuleLabel')}</span>
              <strong>{t(`payroll.overtimeMethods.${rules.overtimeMethod}`)}</strong>
              <small>
                {explainOvertime(t, rules.overtimeMethod, rules, money, dailyWageMinor)}
              </small>
            </div>
            <p className="pb-muted">
              {t('payroll.board.rulesHint')} · {t('payroll.editedCount', { count: editedDayCount })}
            </p>
            <button
              type="button"
              className="pb-button pb-button--ghost"
              onClick={() => setRulesOpen(true)}
            >
              {t('payroll.board.editRules')}
            </button>
          </section>

          <details className="pb-card pb-salary-override">
            <summary>{t('payroll.board.salaryOverride')}</summary>
            <label className="pb-field">
              <span>{t('payroll.monthSalaryOverride')}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={salaryOverride}
                onChange={(event) => {
                  setSalaryOverride(event.target.value);
                  scheduleCalculate(decisions, event.target.value);
                }}
              />
            </label>
            <label className="pb-check">
              <input
                type="checkbox"
                checked={updateEmployeeSalary}
                disabled={!salaryOverride}
                onChange={(event) => setUpdateEmployeeSalary(event.target.checked)}
              />
              <span>{t('payroll.alsoUpdateEmployee')}</span>
            </label>
          </details>

          <div className="pb-actions">
            <button
              className="pb-button"
              type="button"
              disabled={!preview || alreadyApproved || loading}
              onClick={() => void approve()}
            >
              {t('payroll.approve')}
            </button>
            <button
              className="pb-button pb-button--ghost"
              type="button"
              onClick={() => window.print()}
            >
              {t('payroll.print')}
            </button>
          </div>
          <p className="pb-muted">{t('payroll.previewNotice')}</p>
        </aside>

        <section className="pb-days">
          <div className="pb-days-head">
            <h2>{t('payroll.board.dayTable')}</h2>
            <span className="pb-chip pb-chip--rest">
              {t('payroll.followingCount', { count: followingDayCount })}
            </span>
            <span className="pb-chip pb-chip--warn">
              {t('payroll.editedCount', { count: editedDayCount })}
            </span>
            <span className="pb-muted pb-days-hint">{t('payroll.board.dayTableHint')}</span>
          </div>
          <div
            className="pb-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t('payroll.board.dayTable')}
          >
            <table className="pb-table">
              <thead>
                <tr>
                  <th className="pb-col-date">{t('payroll.board.colDate')}</th>
                  <th>{t('payroll.board.colStatus')}</th>
                  <th>{t('payroll.board.colShift')}</th>
                  <th>{t('payroll.board.colCheckIn')}</th>
                  <th>{t('payroll.board.colCheckOut')}</th>
                  <th>{t('payroll.board.colLateMin')}</th>
                  <th>{t('payroll.board.colLateDeduction')}</th>
                  <th>{t('payroll.board.colOvertimeMin')}</th>
                  <th>{t('payroll.board.colOvertimeAddition')}</th>
                  <th className="pb-col-method">{t('payroll.board.colDayMethod')}</th>
                  <th className="pb-col-net">{t('payroll.board.colDayNet')}</th>
                </tr>
              </thead>
              <tbody>
                {dates.length === 0 && (
                  <tr>
                    <td className="pb-empty" colSpan={11}>
                      {loading ? t('common.loading') : t('payroll.board.noDays')}
                    </td>
                  </tr>
                )}
                {dates.map((day) => {
                  const attendance = attendanceDays.get(day.date);
                  const inert = INERT_STATUSES.has(day.status) || day.included === false;
                  const decision = decisions[day.date];
                  const needsReview = REVIEW_STATUSES.has(day.status);
                  const deduction = day.deductionMinor ?? 0;
                  const bonus = day.bonusMinor ?? 0;
                  const absence = day.absenceMinor ?? 0;
                  const dayNet = bonus - deduction - absence;
                  const lateMinutes = day.lateMinutes ?? 0;
                  const overtimeMinutes = day.overtimeMinutes ?? 0;
                  const earlyLeave = attendance?.earlyLeaveMinutes ?? 0;
                  const rowClass = [
                    'pb-row',
                    day.status === 'ABSENT' ? 'pb-row--absent' : '',
                    REST_LIKE_STATUSES.has(day.status) || day.status === 'PENDING_IMPORT'
                      ? 'pb-row--rest'
                      : '',
                    needsReview ? 'pb-row--review' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr key={day.date} className={rowClass}>
                      <th scope="row" className="pb-col-date">
                        <span className="pb-date">
                          {dateLabel.format(new Date(`${day.date}T00:00:00Z`))}
                        </span>
                        {(day.edited || decision) && (
                          <span className="pb-chip pb-chip--rest" title={day.reason ?? ''}>
                            {t('payroll.edited')}
                          </span>
                        )}
                      </th>
                      <td className="pb-status-cell">
                        <span className={`pb-chip pb-chip--${statusTone(day.status)}`}>
                          {t(`attendance.statuses.${day.status}`)}
                        </span>
                      </td>
                      <td className="pb-time pb-shift-cell">
                        <div className="pb-shift-content">
                          {attendance?.scheduledStart ? (
                            <>
                              <span className="pb-shift-time">
                                {timePart(attendance.scheduledStart)}–
                                {timePart(attendance.scheduledEnd)}
                                <DayBadge
                                  offset={dayOffset(attendance.scheduledEnd, day.date)}
                                  t={t}
                                />
                              </span>
                              {attendance.scheduleKind === 'COVERAGE' && (
                                <span className="pb-coverage-badge">
                                  {t('payroll.board.coverage')}
                                </span>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </div>
                      </td>
                      <td className="pb-time">
                        {timePart(attendance?.punchIn)}
                        <DayBadge offset={dayOffset(attendance?.punchIn, day.date)} t={t} />
                      </td>
                      <td className="pb-time">
                        {timePart(attendance?.punchOut)}
                        <DayBadge offset={dayOffset(attendance?.punchOut, day.date)} t={t} />
                      </td>
                      <td className={lateMinutes > 0 ? 'pb-num is-warn' : 'pb-num'}>
                        {lateMinutes}
                        {day.status === 'EARLY_LEAVE' && earlyLeave > 0 && (
                          <small>
                            {t('payroll.board.earlyLeaveMinutes', { minutes: earlyLeave })}
                          </small>
                        )}
                      </td>
                      <td className={deduction > 0 ? 'pb-num is-bad' : 'pb-num'}>
                        {deduction > 0 ? signed(-deduction) : '—'}
                      </td>
                      <td className={overtimeMinutes > 0 ? 'pb-num is-good' : 'pb-num'}>
                        {overtimeMinutes}
                        {overtimeMinutes > 0 && day.countedOvertimeMinutes !== overtimeMinutes && (
                          <small>
                            {t('payroll.board.countedOf', {
                              minutes: day.countedOvertimeMinutes ?? 0,
                            })}
                          </small>
                        )}
                      </td>
                      <td className={bonus > 0 ? 'pb-num is-good' : 'pb-num'}>
                        {bonus > 0 ? signed(bonus) : '—'}
                      </td>
                      <td className="pb-col-method">
                        {inert ? (
                          <span className="pb-muted">—</span>
                        ) : (
                          <div className="pb-method-cell">
                            <label>
                              <span className="pb-method-label pb-method-label--late">
                                {t('payroll.board.lateSelect')}
                              </span>
                              <select
                                value={decision?.lateMethod ?? ''}
                                onChange={(event) =>
                                  changeDecision(day.date, {
                                    lateMethod: (event.target.value || undefined) as
                                      LateMethod | undefined,
                                  })
                                }
                              >
                                <option value="">
                                  {t('payroll.board.followMonthNamed', {
                                    method: t(`payroll.lateMethods.${rules.lateMethod}`),
                                  })}
                                </option>
                                {DAY_LATE_METHODS.map((method) => (
                                  <option key={method} value={method}>
                                    {t(`payroll.lateMethods.${method}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {decision?.lateMethod === 'custom_amount' && (
                              <CustomAmount
                                amountMinor={decision.lateCustomAmountMinor ?? 0}
                                reason={decision.lateReason ?? ''}
                                t={t}
                                onChange={(amountMinor, reason) =>
                                  changeDecision(day.date, {
                                    lateCustomAmountMinor: amountMinor,
                                    lateReason: reason,
                                  })
                                }
                              />
                            )}
                            <label>
                              <span className="pb-method-label pb-method-label--overtime">
                                {t('payroll.board.overtimeSelect')}
                              </span>
                              <select
                                value={decision?.overtimeMethod ?? ''}
                                onChange={(event) =>
                                  changeDecision(day.date, {
                                    overtimeMethod: (event.target.value || undefined) as
                                      OvertimeMethod | undefined,
                                  })
                                }
                              >
                                <option value="">
                                  {t('payroll.board.followMonthNamed', {
                                    method: t(`payroll.overtimeMethods.${rules.overtimeMethod}`),
                                  })}
                                </option>
                                {DAY_OVERTIME_METHODS.map((method) => (
                                  <option key={method} value={method}>
                                    {t(`payroll.overtimeMethods.${method}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {decision?.overtimeMethod === 'custom_amount' && (
                              <CustomAmount
                                amountMinor={decision.overtimeCustomAmountMinor ?? 0}
                                reason={decision.overtimeReason ?? ''}
                                t={t}
                                onChange={(amountMinor, reason) =>
                                  changeDecision(day.date, {
                                    overtimeCustomAmountMinor: amountMinor,
                                    overtimeReason: reason,
                                  })
                                }
                              />
                            )}
                          </div>
                        )}
                      </td>
                      <td
                        className={`pb-col-net pb-num ${dayNet < 0 ? 'is-bad' : dayNet > 0 ? 'is-good' : ''}`}
                      >
                        {signed(dayNet)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {runs.length > 0 && (
        <section className="pb-card pb-history">
          <h2>{t('payroll.history')}</h2>
          {runs.map((run) => (
            <div className="pb-run" key={run.id}>
              <div>
                <strong>
                  #{run.id} ·{' '}
                  {t(`payroll.${run.status === 'approved' ? 'approvedStatus' : 'voidStatus'}`)}
                </strong>
                <span>
                  {new Date(run.approvedAt).toLocaleString(locale)} ·{' '}
                  {money(run.result.finalSalaryMinor ?? run.result.netPayMinor ?? 0)}
                </span>
              </div>
              {run.status === 'approved' && (
                <div className="pb-void">
                  <input
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.target.value)}
                    placeholder={t('payroll.voidReason')}
                    aria-label={t('payroll.voidReason')}
                  />
                  <button
                    type="button"
                    className="pb-button pb-button--danger"
                    onClick={() => void voidRun(run.id)}
                    disabled={!voidReason.trim()}
                  >
                    {t('payroll.void')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {rulesOpen && (
        <PayrollRulesDialog
          initial={rules}
          dailyWageMinor={dailyWageMinor}
          money={money}
          editedDayCount={editedDayCount}
          followingDayCount={followingDayCount}
          onCancel={cancelRules}
          onSave={saveRules}
          onResetEditedDays={resetEditedDays}
        />
      )}
    </section>
  );
};

type Translate = ReturnType<typeof useTranslation>['t'];

const Counter = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'bad' | 'warn' | 'rest';
}): React.JSX.Element => (
  <div className={`pb-counter pb-counter--${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const DayBadge = ({ offset, t }: { offset: number; t: Translate }): React.JSX.Element | null =>
  offset === 0 ? null : (
    <span
      className="pb-day-badge"
      title={offset > 0 ? t('payroll.board.nextDay') : t('payroll.board.previousDay')}
      aria-label={offset > 0 ? t('payroll.board.nextDay') : t('payroll.board.previousDay')}
    >
      {offset > 0 ? '+1' : '−1'}
    </span>
  );

const CustomAmount = ({
  amountMinor,
  reason,
  onChange,
  t,
}: {
  amountMinor: number;
  reason: string;
  onChange: (amountMinor: number, reason: string) => void;
  t: Translate;
}): React.JSX.Element => {
  const [amount, setAmount] = useState(amountMinor ? String(amountMinor / 100) : '');
  const missingReason = !reason.trim();
  return (
    <div className="pb-custom">
      <input
        type="number"
        min="0"
        step="0.01"
        value={amount}
        aria-label={t('payroll.customAmount')}
        placeholder={t('payroll.customAmount')}
        onChange={(event) => {
          setAmount(event.target.value);
          onChange(egpInputToMinor(event.target.value), reason);
        }}
      />
      <input
        required
        value={reason}
        aria-invalid={missingReason}
        aria-label={t('payroll.customReason')}
        placeholder={t('payroll.customReason')}
        onChange={(event) => onChange(egpInputToMinor(amount), event.target.value)}
      />
      {missingReason && <small className="pb-error">{t('payroll.board.reasonRequired')}</small>}
    </div>
  );
};
