import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  EmployeeDto,
  PayrollPolicyConfigDto,
  PayrollPolicyDto,
  PayrollPreviewDto,
  PayrollRunDto,
} from '../../shared/ipc';

const cairoMonth = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);

interface PayrollScreenProps {
  isAdmin: boolean;
}

export const PayrollScreen = ({ isAdmin }: PayrollScreenProps): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage === 'ar' ? 'ar-EG' : 'en-EG';
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [policies, setPolicies] = useState<readonly PayrollPolicyDto[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(cairoMonth());
  const [penaltyMode, setPenaltyMode] = useState<
    'fixed_hourly_amount' | 'day_any_lateness' | 'day_at_threshold' | 'none'
  >('fixed_hourly_amount');
  const [hourlyAmount, setHourlyAmount] = useState('100');
  const [lateRoundingByDate, setLateRoundingByDate] = useState<Record<string, 'exact' | 'hour_up'>>(
    {},
  );
  const [preview, setPreview] = useState<PayrollPreviewDto | null>(null);
  const [runs, setRuns] = useState<readonly PayrollRunDto[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const money = (minor: number): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(minor / 100);

  const duration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours && remainder) return t('payroll.hoursMinutes', { hours, minutes: remainder });
    if (hours) return t('payroll.hoursOnly', { hours });
    return t('payroll.minutesOnly', { minutes: remainder });
  };

  const loadBase = async (): Promise<void> => {
    if (!window.dawam || !isAdmin) return;
    setLoading(true);
    const [employeeResult, policyResult] = await Promise.all([
      window.dawam.workforce.listEmployees(),
      window.dawam.payroll.listPolicies(),
    ]);
    if (employeeResult.ok) {
      const activeEmployees = employeeResult.value.filter((employee) => employee.active);
      setEmployees(activeEmployees);
      setEmployeeId((current) => current || String(activeEmployees[0]?.id ?? ''));
    } else setMessage(t(employeeResult.error.messageKey));
    if (policyResult.ok) setPolicies(policyResult.value);
    else setMessage(t(policyResult.error.messageKey));
    setLoading(false);
  };

  const loadRuns = async (): Promise<void> => {
    if (!window.dawam || !employeeId) return;
    const result = await window.dawam.payroll.listRuns({ employeeId: Number(employeeId), month });
    if (result.ok) setRuns(result.value);
  };

  useEffect(() => {
    void loadBase();
  }, [isAdmin]);

  useEffect(() => {
    setPreview(null);
    setLateRoundingByDate({});
    void loadRuns();
  }, [employeeId, month]);

  const selectedConfig = (): PayrollPolicyConfigDto => ({
    policy:
      penaltyMode === 'fixed_hourly_amount'
        ? { id: 'fixed_hourly_amount', amountMinor: Math.round(Number(hourlyAmount) * 100) }
        : penaltyMode === 'day_any_lateness'
          ? { id: 'day_any_lateness' }
          : penaltyMode === 'day_at_threshold'
            ? { id: 'day_at_threshold', thresholdMinutes: 60 }
            : { id: 'none' },
    options: {
      graceMinutes: 0,
      graceMode: 'threshold',
      capPerDateMinor: null,
      absenceMultiplier: { numerator: 1, denominator: 1 },
    },
  });

  const findOrCreatePolicy = async (): Promise<number | null> => {
    if (!window.dawam) return null;
    const config = selectedConfig();
    const existing = policies.find(
      (policy) => JSON.stringify(policy.config) === JSON.stringify(config),
    );
    if (existing) return existing.id;
    const result = await window.dawam.payroll.createPolicy({
      name:
        penaltyMode === 'fixed_hourly_amount'
          ? `Fixed ${hourlyAmount} EGP per late hour`
          : penaltyMode === 'day_any_lateness'
            ? 'One daily wage for any lateness on a date'
            : penaltyMode === 'day_at_threshold'
              ? 'One daily wage when daily lateness reaches one hour'
              : 'No lateness deduction',
      config,
      reason: 'Payroll rule selected for monthly calculation',
    });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return null;
    }
    setPolicies((current) => [...current, result.value]);
    return result.value.id;
  };

  const calculatePreview = async (
    rounding: Record<string, 'exact' | 'hour_up'> = lateRoundingByDate,
  ): Promise<void> => {
    if (!window.dawam || !employeeId) return;
    if (penaltyMode === 'fixed_hourly_amount' && Number(hourlyAmount) < 0) return;
    setLoading(true);
    setMessage('');
    const selectedPolicyId = await findOrCreatePolicy();
    if (!selectedPolicyId) {
      setLoading(false);
      return;
    }
    const result = await window.dawam.payroll.preview({
      employeeId: Number(employeeId),
      month,
      policyId: selectedPolicyId,
      lateRoundingByDate: rounding,
    });
    if (result.ok) setPreview(result.value);
    else setMessage(t(result.error.messageKey));
    setLoading(false);
  };

  const approve = async (): Promise<void> => {
    if (!window.dawam || !preview) return;
    const result = await window.dawam.payroll.approve({
      employeeId: preview.employee.id,
      month: preview.month,
      policyId: preview.policy.id,
      lateRoundingByDate,
      reason: `Monthly payroll approved for ${preview.month}`,
    });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return;
    }
    setMessage(t('payroll.approved'));
    await loadRuns();
  };

  const voidRun = async (runId: number): Promise<void> => {
    if (!window.dawam) return;
    const result = await window.dawam.payroll.voidRun({ runId, reason: voidReason });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return;
    }
    setVoidReason('');
    setMessage(t('payroll.voided'));
    await loadRuns();
  };

  if (!isAdmin) return <section className="card empty-state">{t('payroll.adminOnly')}</section>;

  const lateDays = preview?.result.dates.filter((day) => day.actualLateMinutes > 0) ?? [];
  const chargedLateMinutes = preview
    ? Math.round(
        preview.result.dates.reduce(
          (total, day) =>
            total +
            (preview.policy.config.policy.id === 'fixed_hourly_amount'
              ? day.billableUnits * 60
              : day.billableLateMinutes),
          0,
        ),
      )
    : 0;
  const selectedEmployee = employees.find((employee) => String(employee.id) === employeeId);

  return (
    <section className="module-screen payroll-screen">
      <div className="module-header">
        <div>
          <span className="eyebrow">{t('payroll.eyebrow')}</span>
          <h1>{t('payroll.title')}</h1>
          <p>{t('payroll.simpleSubtitle')}</p>
        </div>
      </div>

      <section className="card payroll-rule-summary">
        <div>
          <strong>{t('payroll.ruleTitle')}</strong>
          <span>{t('payroll.chooseSimpleRule')}</span>
        </div>
        <div className="payroll-rule-choices">
          <label className={penaltyMode === 'fixed_hourly_amount' ? 'selected' : ''}>
            <input
              type="radio"
              name="penalty-mode"
              checked={penaltyMode === 'fixed_hourly_amount'}
              onChange={() => setPenaltyMode('fixed_hourly_amount')}
            />
            <span>
              <b>{t('payroll.fixedHourRule')}</b>
              <small>{t('payroll.fixedHourHelp')}</small>
            </span>
          </label>
          <label className={penaltyMode === 'day_any_lateness' ? 'selected' : ''}>
            <input
              type="radio"
              name="penalty-mode"
              checked={penaltyMode === 'day_any_lateness'}
              onChange={() => setPenaltyMode('day_any_lateness')}
            />
            <span>
              <b>{t('payroll.anyLateDayRule')}</b>
              <small>{t('payroll.anyLateDayHelp')}</small>
            </span>
          </label>
          <label className={penaltyMode === 'day_at_threshold' ? 'selected' : ''}>
            <input
              type="radio"
              name="penalty-mode"
              checked={penaltyMode === 'day_at_threshold'}
              onChange={() => setPenaltyMode('day_at_threshold')}
            />
            <span>
              <b>{t('payroll.lateDayRule')}</b>
              <small>{t('payroll.lateDayHelp')}</small>
            </span>
          </label>
          <label className={penaltyMode === 'none' ? 'selected' : ''}>
            <input
              type="radio"
              name="penalty-mode"
              checked={penaltyMode === 'none'}
              onChange={() => setPenaltyMode('none')}
            />
            <span>
              <b>{t('payroll.noLateRule')}</b>
              <small>{t('payroll.noLateHelp')}</small>
            </span>
          </label>
        </div>
        {penaltyMode === 'fixed_hourly_amount' && (
          <label className="hourly-amount-field">
            <span>{t('payroll.amountPerHour')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={hourlyAmount}
              onChange={(event) => setHourlyAmount(event.target.value)}
            />
          </label>
        )}
        <p>{t('payroll.fixedRulesNote')}</p>
      </section>

      <div className="card payroll-filters simple">
        <label>
          <span>{t('employees.employee')}</span>
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ·{' '}
                {employee.monthlySalaryMinor == null
                  ? t('payroll.noSalary')
                  : money(employee.monthlySalaryMinor)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('attendance.month')}</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <button
          className="module-primary"
          type="button"
          onClick={() => void calculatePreview()}
          disabled={
            loading ||
            !employeeId ||
            (penaltyMode === 'fixed_hourly_amount' && (!hourlyAmount || Number(hourlyAmount) < 0))
          }
        >
          {t('payroll.calculate')}
        </button>
      </div>

      {selectedEmployee && (
        <section className="card payroll-employee-identity">
          <div>
            <span>{t('employees.employee')}</span>
            <strong>{selectedEmployee.fullName}</strong>
          </div>
          <div>
            <span>{t('employees.deviceId')}</span>
            <strong>{selectedEmployee.deviceUserId}</strong>
          </div>
          <div>
            <span>{t('payroll.salary')}</span>
            <strong>
              {selectedEmployee.monthlySalaryMinor == null
                ? t('payroll.noSalary')
                : money(selectedEmployee.monthlySalaryMinor)}
            </strong>
          </div>
        </section>
      )}

      {message && <div className="success-note">{message}</div>}
      {loading && <div className="card empty-state">{t('common.loading')}</div>}

      {preview && !loading && (
        <>
          <div className="preview-banner">{t('payroll.previewBanner')}</div>
          <div className="payroll-summary expanded">
            <article className="card">
              <span>{t('payroll.salary')}</span>
              <strong>{money(preview.result.monthlySalaryMinor)}</strong>
            </article>
            <article className="card">
              <span>{t('payroll.dailyWage')}</span>
              <strong>{money(preview.result.dailyWageMinor)}</strong>
            </article>
            <article className="card">
              <span>
                {t('payroll.lateSummaryDetailed', {
                  actual: duration(preview.result.totalLateMinutes),
                  charged: duration(chargedLateMinutes),
                  days: lateDays.length,
                })}
              </span>
              <strong>{money(preview.result.latenessDeductionMinor)}</strong>
            </article>
            <article className="card">
              <span>{t('payroll.absenceSummary', { count: preview.result.absenceDays })}</span>
              <strong>{money(preview.result.absenceDeductionMinor)}</strong>
            </article>
            <article className="card total">
              <span>{t('payroll.net')}</span>
              <strong>{money(preview.result.netPayMinor)}</strong>
            </article>
          </div>
          {preview.result.warnings.length > 0 && (
            <div className="form-error">{t('payroll.negativeNet')}</div>
          )}
          <div className="card table-card payroll-table simple">
            <div className="payroll-table-heading">
              <strong>{t('payroll.distributionTitle')}</strong>
              <span>{t('payroll.distributionHelp')}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t('attendance.date')}</th>
                  <th>{t('attendance.status')}</th>
                  <th>{t('payroll.actualLate')}</th>
                  <th>{t('payroll.lateTreatment')}</th>
                  <th>{t('payroll.billable')}</th>
                  <th>{t('payroll.appliedRule')}</th>
                  <th>{t('payroll.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.result.dates.map((day) => (
                  <tr
                    className={
                      day.actualLateMinutes > 0 || day.status === 'ABSENT' ? 'affected' : ''
                    }
                    key={day.date}
                  >
                    <td>{day.date}</td>
                    <td>{t(`attendance.statuses.${day.status}`)}</td>
                    <td>{duration(day.actualLateMinutes)}</td>
                    <td>
                      {penaltyMode === 'fixed_hourly_amount' && day.actualLateMinutes > 0 ? (
                        <select
                          className="late-treatment-select"
                          value={lateRoundingByDate[day.date] ?? 'exact'}
                          onChange={(event) => {
                            const next = {
                              ...lateRoundingByDate,
                              [day.date]: event.target.value as 'exact' | 'hour_up',
                            };
                            setLateRoundingByDate(next);
                            void calculatePreview(next);
                          }}
                        >
                          <option value="exact">{t('payroll.keepExact')}</option>
                          <option value="hour_up">{t('payroll.roundThisDay')}</option>
                        </select>
                      ) : (
                        t('payroll.notApplicable')
                      )}
                    </td>
                    <td>
                      {duration(
                        preview.policy.config.policy.id === 'fixed_hourly_amount'
                          ? Math.round(day.billableUnits * 60)
                          : day.billableLateMinutes,
                      )}
                    </td>
                    <td>{t(`payroll.policies.${preview.policy.config.policy.id}`)}</td>
                    <td>{money(day.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card payroll-approval simple">
            <div>
              <strong>{t('payroll.approveTitle')}</strong>
              <span>{t('payroll.approveSimpleWarning')}</span>
            </div>
            <button
              className="module-primary"
              type="button"
              onClick={() => void approve()}
              disabled={runs.some((run) => run.status === 'approved')}
            >
              {t('payroll.approve')}
            </button>
          </div>
        </>
      )}

      {runs.length > 0 && (
        <section className="card payroll-history">
          <h2>{t('payroll.history')}</h2>
          {runs.map((run) => (
            <div className="payroll-run" key={run.id}>
              <div>
                <strong>
                  #{run.id} ·{' '}
                  {run.status === 'approved'
                    ? t('payroll.approvedStatus')
                    : t('payroll.voidStatus')}
                </strong>
                <span>
                  {new Date(run.approvedAt).toLocaleString(locale)} ·{' '}
                  {money(run.result.netPayMinor)}
                </span>
                {run.voidReason && <small>{run.voidReason}</small>}
              </div>
              {run.status === 'approved' && (
                <div className="void-controls">
                  <input
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.target.value)}
                    placeholder={t('payroll.voidReason')}
                  />
                  <button
                    type="button"
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
    </section>
  );
};
