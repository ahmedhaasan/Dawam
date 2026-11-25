import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStickyOffsets } from './useStickyOffsets';

import type {
  AttendanceDayDto,
  AttendanceMonthDto,
  EmployeeDto,
  ShiftTemplateDto,
} from '../../shared/ipc';

const currentCairoMonth = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);

const timeOnly = (value?: string): string => (value ? value.slice(11, 16) : '—');
const inputDateTime = (value: string): string => value.replace(' ', 'T').slice(0, 16);
const apiDateTime = (value: string): string => `${value.replace('T', ' ')}:00`;
const isNextDay = (rowDate: string, value?: string): boolean =>
  Boolean(value && value.slice(0, 10) > rowDate);

type AdjustKind = 'shift' | 'rest' | 'work_default' | 'cancel_coverage';

interface DayPanel {
  day: AttendanceDayDto;
  field: 'in' | 'out';
  time: string;
  reason: string;
  kind: AdjustKind;
  templateId: string;
  adjustReason: string;
  showAdjust: boolean;
}

const LEGEND_STATUSES = [
  'PRESENT',
  'EARLY_LEAVE',
  'REVIEW',
  'MISSING_IN',
  'MISSING_OUT',
  'ABSENT',
  'NOT_CLOSED',
  'PENDING_IMPORT',
  'REST',
  'LEAVE',
  'PERMISSION',
] as const;

const svgProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

const CheckInIcon = (): React.JSX.Element => (
  <svg {...svgProps} className="att-icon-flip">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="M10 17l5-5-5-5" />
    <path d="M15 12H3" />
  </svg>
);

const CheckOutIcon = (): React.JSX.Element => (
  <svg {...svgProps} className="att-icon-flip">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const EditIcon = (): React.JSX.Element => (
  <svg {...svgProps}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const RefreshIcon = (): React.JSX.Element => (
  <svg {...svgProps}>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

interface AttendanceScreenProps {
  isAdmin: boolean;
}

export const AttendanceScreen = ({ isAdmin }: AttendanceScreenProps): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage === 'ar' ? 'ar-EG' : 'en-GB';
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [templates, setTemplates] = useState<readonly ShiftTemplateDto[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(currentCairoMonth());
  const [report, setReport] = useState<AttendanceMonthDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'days' | 'overtime'>('days');
  const [panel, setPanel] = useState<DayPanel | null>(null);
  const requestRef = useRef(0);
  const screenRef = useStickyOffsets<HTMLElement>('.att-toolbar');
  const panelRef = useRef<HTMLFormElement | null>(null);

  const loadEmployees = async (): Promise<void> => {
    if (!window.dawam) {
      setLoading(false);
      return;
    }
    const [result, templateResult] = await Promise.all([
      window.dawam.workforce.listEmployees(),
      window.dawam.workforce.listTemplates(),
    ]);
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      setLoading(false);
      return;
    }
    const active = result.value.filter((employee) => employee.active);
    setEmployees(active);
    setEmployeeId((current) =>
      active.some((employee) => String(employee.id) === current)
        ? current
        : String(active[0]?.id ?? ''),
    );
    if (templateResult.ok) setTemplates(templateResult.value);
    setLoading(false);
  };

  useEffect(() => {
    void loadEmployees();
  }, []);

  const loadMonth = async (): Promise<void> => {
    const requestId = ++requestRef.current;
    if (!window.dawam || !employeeId) {
      setReport(null);
      return;
    }
    setLoading(true);
    const result = await window.dawam.attendance.month({ employeeId: Number(employeeId), month });
    // Ignore stale responses when the employee/month changed while loading.
    if (requestId !== requestRef.current) return;
    if (result.ok) setReport(result.value);
    else {
      setReport(null);
      setMessage(t(result.error.messageKey));
    }
    setLoading(false);
  };

  useEffect(() => {
    setPanel(null);
    setMessage('');
    void loadMonth();
  }, [employeeId, month]);

  useEffect(() => {
    if (panel) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [panel?.day.date]);

  const refresh = async (): Promise<void> => {
    setMessage('');
    await loadEmployees();
    await loadMonth();
  };

  const totals = useMemo(() => {
    const counts = report?.summary.statusCounts ?? {};
    return {
      present: counts.PRESENT ?? 0,
      earlyLeave: counts.EARLY_LEAVE ?? 0,
      absent: counts.ABSENT ?? 0,
      review:
        (counts.REVIEW ?? 0) +
        (counts.MISSING_IN ?? 0) +
        (counts.MISSING_OUT ?? 0) +
        (counts.PENDING_IMPORT ?? 0) +
        (counts.NOT_CLOSED ?? 0) +
        (counts.COVERAGE_NEEDED ?? 0),
    };
  }, [report]);

  const punchTime = (day: AttendanceDayDto, field: 'in' | 'out'): string => {
    const existing = field === 'in' ? day.punchIn : day.punchOut;
    const fallback =
      (field === 'in' ? day.scheduledStart : day.scheduledEnd) ?? `${day.date} 10:00:00`;
    return inputDateTime(existing ?? fallback);
  };

  const openPanel = (day: AttendanceDayDto, field: 'in' | 'out', showAdjust: boolean): void => {
    setMessage('');
    setPanel({
      day,
      field,
      time: punchTime(day, field),
      reason: '',
      kind: 'rest',
      templateId: String(templates[0]?.id ?? ''),
      adjustReason: '',
      showAdjust,
    });
  };

  const saveCorrection = async (): Promise<void> => {
    if (!window.dawam || !panel || !panel.reason.trim()) return;
    setMessage('');
    const result = await window.dawam.attendance.correct({
      employeeId: Number(employeeId),
      shiftDate: panel.day.date,
      field: panel.field,
      newTimeLocal: panel.time ? apiDateTime(panel.time) : null,
      reason: panel.reason.trim(),
    });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return;
    }
    setPanel(null);
    setMessage(t('attendance.correctionSaved'));
    await loadMonth();
  };

  const saveAdjustment = async (): Promise<void> => {
    if (!window.dawam || !panel || !panel.adjustReason.trim()) return;
    setMessage('');
    const result = await window.dawam.workforce.setOverride({
      employeeId: Number(employeeId),
      date: panel.day.date,
      kind: panel.kind,
      ...(panel.kind === 'shift' ? { templateId: Number(panel.templateId) } : {}),
      reason: panel.adjustReason.trim(),
    });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return;
    }
    setPanel(null);
    setMessage(t('attendance.exceptionSaved'));
    await loadMonth();
  };

  const duration = (minutes: number): string =>
    t('attendance.lateDuration', {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    });

  const formatDate = (date: string, withWeekday: boolean): string =>
    new Intl.DateTimeFormat(locale, {
      ...(withWeekday ? { weekday: 'short' as const } : {}),
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));

  const formatWeekday = (date: string): string =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`),
    );

  const printReport = (): void => window.print();

  const exportCsv = (): void => {
    if (!report) return;
    const rows = [
      [
        'Date',
        'Shift',
        'First check-in',
        'Last check-out',
        'Hours',
        'Late minutes',
        'Early leave',
        'Overtime minutes',
        'Status',
      ],
      ...report.days.map((day) => [
        day.date,
        day.templateName ?? day.scheduleKind,
        day.punchIn ?? '',
        day.punchOut ?? '',
        day.hours ?? '',
        day.lateMinutes ?? '',
        day.earlyLeaveMinutes ?? '',
        day.overtimeMinutes ?? '',
        day.status,
      ]),
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dawam-${report.employee.deviceUserId}-${report.month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const timeCell = (day: AttendanceDayDto, value?: string): React.JSX.Element => (
    <span className="att-time">
      <bdi>{timeOnly(value)}</bdi>
      {isNextDay(day.date, value) && (
        <span className="att-next-day" title={t('attendance.nextDay')}>
          <bdi>+1</bdi>
          <span className="att-sr-only">{t('attendance.nextDay')}</span>
        </span>
      )}
    </span>
  );

  const minutesCell = (minutes: number | null, tone?: 'warn' | 'good'): React.JSX.Element =>
    minutes === null ? (
      <span className="att-muted">—</span>
    ) : (
      <span className={minutes > 0 && tone ? `att-num att-num-${tone}` : 'att-num'}>
        {duration(minutes)}
      </span>
    );

  const summaryTiles: readonly { key: string; label: string; value: string; tone?: string }[] =
    report
      ? [
          {
            key: 'present',
            label: t('attendance.present'),
            value: String(totals.present),
            tone: 'good',
          },
          {
            key: 'early',
            label: t('attendance.earlyLeaveCount'),
            value: String(totals.earlyLeave),
            tone: 'warn',
          },
          {
            key: 'absent',
            label: t('attendance.absent'),
            value: String(totals.absent),
            tone: 'bad',
          },
          {
            key: 'review',
            label: t('attendance.reviewCount'),
            value: String(totals.review),
            tone: 'warn',
          },
          {
            key: 'worked',
            label: t('attendance.totalWorked'),
            value: duration(report.summary.totalWorkedMinutes),
          },
          {
            key: 'late',
            label: t('attendance.totalLate'),
            value: duration(report.summary.totalLateMinutes),
          },
          {
            key: 'overtime',
            label: t('attendance.totalOvertime'),
            value: duration(report.summary.totalOvertimeMinutes),
          },
        ]
      : [];

  return (
    <section ref={screenRef} className="module-screen attendance-screen">
      <div className="att-header">
        <div className="att-heading">
          <span className="eyebrow">{t('attendance.eyebrow')}</span>
          <h1>{t('attendance.title')}</h1>
          <p>{t('attendance.subtitle')}</p>
        </div>
      </div>

      <div className="card att-toolbar">
        <label className="att-field att-field-employee">
          <span>{t('employees.employee')}</span>
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} · {employee.deviceUserId}
              </option>
            ))}
          </select>
        </label>
        <label className="att-field att-field-month">
          <span>{t('attendance.month')}</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <div className="att-toolbar-actions">
          <button
            type="button"
            className="att-icon-btn"
            title={t('attendance.refresh')}
            aria-label={t('attendance.refresh')}
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshIcon />
          </button>
          <button type="button" className="att-btn" onClick={exportCsv} disabled={!report}>
            {t('attendance.exportCsv')}
          </button>
          <button type="button" className="att-btn" onClick={printReport} disabled={!report}>
            {t('attendance.printPdf')}
          </button>
        </div>
      </div>

      {report && report.summary.ignoredRepeatedPunches.length > 0 && (
        <div className="att-note">
          {t('attendance.ignoredRepeats', {
            count: report.summary.ignoredRepeatedPunches.length,
          })}
        </div>
      )}

      {message && (
        <div className="att-message" role="status">
          {message}
        </div>
      )}
      {loading && !report && <div className="card empty-state">{t('common.loading')}</div>}
      {!loading && employees.length === 0 && (
        <div className="card empty-state">{t('attendance.noEmployees')}</div>
      )}
      {report && (
        <>
          <div className="card att-summary" aria-busy={loading}>
            <div className="att-summary-person">
              <span>{t('employees.employee')}</span>
              <strong>{report.employee.fullName}</strong>
              <small>
                <bdi>{report.employee.deviceUserId}</bdi> · <bdi>{report.month}</bdi>
              </small>
            </div>
            {summaryTiles.map((tile) => (
              <div
                key={tile.key}
                className={tile.tone ? `att-tile att-tile-${tile.tone}` : 'att-tile'}
              >
                <span>{tile.label}</span>
                <strong>{tile.value}</strong>
              </div>
            ))}
          </div>

          <details className="att-legend">
            <summary>{t('attendance.legendTitle')}</summary>
            <div className="att-legend-chips">
              {LEGEND_STATUSES.map((status) => (
                <span key={status} className={`att-chip att-chip-${status.toLowerCase()}`}>
                  {t(`attendance.statuses.${status}`)}
                </span>
              ))}
            </div>
            <ul>
              <li>{t('attendance.earlyLeaveHelp')}</li>
              <li>{t('attendance.reviewHelp')}</li>
              <li>{t('attendance.notClosedHelp')}</li>
              <li>
                <strong>{t('attendance.safeAbsence')}:</strong> {t('attendance.safeAbsenceDetail')}
              </li>
              <li>{t('attendance.nightShiftHelp')}</li>
            </ul>
          </details>

          <div className="att-tabs" role="tablist" aria-label={t('attendance.viewLabel')}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'days'}
              className={activeTab === 'days' ? 'active' : ''}
              onClick={() => setActiveTab('days')}
            >
              {t('attendance.dailyTab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'overtime'}
              className={activeTab === 'overtime' ? 'active' : ''}
              onClick={() => setActiveTab('overtime')}
            >
              {t('attendance.overtimeTab')}
            </button>
          </div>

          {panel && isAdmin && (
            <form
              ref={panelRef}
              className="card att-panel"
              onSubmit={(event) => {
                event.preventDefault();
                void saveCorrection();
              }}
            >
              <header className="att-panel-head">
                <div>
                  <span className="eyebrow">{t('attendance.dayPanelTitle')}</span>
                  <h2>{formatDate(panel.day.date, true)}</h2>
                  <small>
                    {panel.day.templateName ?? t(`schedule.kinds.${panel.day.scheduleKind}`)} ·{' '}
                    {t(`attendance.statuses.${panel.day.status}`)}
                  </small>
                </div>
                <button type="button" className="att-btn" onClick={() => setPanel(null)}>
                  {t('common.cancel')}
                </button>
              </header>

              <div className="att-panel-body">
                <fieldset className="att-panel-group">
                  <legend>{t('attendance.punchSection')}</legend>
                  <p className="att-panel-help">{t('attendance.punchSectionHelp')}</p>
                  <div
                    className="att-segment"
                    role="radiogroup"
                    aria-label={t('attendance.punchSection')}
                  >
                    {(['in', 'out'] as const).map((field) => (
                      <button
                        key={field}
                        type="button"
                        role="radio"
                        aria-checked={panel.field === field}
                        className={panel.field === field ? 'active' : ''}
                        onClick={() =>
                          setPanel({ ...panel, field, time: punchTime(panel.day, field) })
                        }
                      >
                        {field === 'in' ? <CheckInIcon /> : <CheckOutIcon />}
                        {t(`attendance.fields.${field}`)}
                      </button>
                    ))}
                  </div>
                  <div className="att-panel-fields">
                    <label className="att-field">
                      <span>{t('attendance.correctedTime')}</span>
                      <input
                        type="datetime-local"
                        value={panel.time}
                        onChange={(event) => setPanel({ ...panel, time: event.target.value })}
                      />
                    </label>
                    <label className="att-field att-field-wide">
                      <span>
                        {t('common.reason')} <em aria-hidden="true">*</em>
                      </span>
                      <input
                        value={panel.reason}
                        onChange={(event) => setPanel({ ...panel, reason: event.target.value })}
                        required
                      />
                    </label>
                  </div>
                  <div className="att-panel-actions">
                    <button
                      className="module-primary"
                      type="submit"
                      disabled={!panel.reason.trim()}
                    >
                      {t('attendance.saveCorrection')}
                    </button>
                  </div>
                </fieldset>

                {panel.showAdjust ? (
                  <fieldset className="att-panel-group">
                    <legend>{t('attendance.adjustSection')}</legend>
                    <p className="att-panel-help">{t('attendance.adjustSectionHelp')}</p>
                    <div className="att-panel-fields">
                      <label className="att-field">
                        <span>{t('attendance.exceptionType')}</span>
                        <select
                          value={panel.kind}
                          onChange={(event) =>
                            setPanel({ ...panel, kind: event.target.value as AdjustKind })
                          }
                        >
                          <option value="shift">{t('schedule.forceShift')}</option>
                          <option value="rest">{t('schedule.forceRest')}</option>
                          <option value="work_default">{t('schedule.forceWork')}</option>
                          <option value="cancel_coverage">{t('schedule.cancelCoverage')}</option>
                        </select>
                      </label>
                      {panel.kind === 'shift' && (
                        <label className="att-field">
                          <span>{t('schedule.template')}</span>
                          <select
                            value={panel.templateId}
                            onChange={(event) =>
                              setPanel({ ...panel, templateId: event.target.value })
                            }
                          >
                            {templates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="att-field att-field-wide">
                        <span>
                          {t('attendance.exceptionReason')} <em aria-hidden="true">*</em>
                        </span>
                        <input
                          value={panel.adjustReason}
                          onChange={(event) =>
                            setPanel({ ...panel, adjustReason: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="att-panel-actions">
                      <button
                        className="module-primary"
                        type="button"
                        disabled={!panel.adjustReason.trim()}
                        onClick={() => void saveAdjustment()}
                      >
                        {t('attendance.saveAdjustment')}
                      </button>
                    </div>
                  </fieldset>
                ) : (
                  <button
                    type="button"
                    className="att-btn att-panel-more"
                    onClick={() => setPanel({ ...panel, showAdjust: true })}
                  >
                    <EditIcon />
                    {t('attendance.dayException')}
                  </button>
                )}
              </div>
            </form>
          )}

          {activeTab === 'days' ? (
            <div className="card att-table-wrap" aria-busy={loading}>
              <table className={isAdmin ? 'att-table has-actions' : 'att-table'}>
                <thead>
                  <tr>
                    <th scope="col" className="att-col-date">
                      {t('attendance.date')}
                    </th>
                    <th scope="col" className="att-col-shift">
                      {t('attendance.shift')}
                    </th>
                    <th scope="col">{t('attendance.in')}</th>
                    <th scope="col">{t('attendance.out')}</th>
                    <th scope="col">{t('attendance.hours')}</th>
                    <th scope="col">{t('attendance.late')}</th>
                    <th scope="col">{t('attendance.early')}</th>
                    <th scope="col">{t('attendance.overtime')}</th>
                    <th scope="col" className="att-col-status">
                      {t('attendance.status')}
                    </th>
                    {isAdmin && (
                      <th scope="col" className="att-col-actions">
                        {t('common.actions')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => (
                    <tr
                      key={day.date}
                      className={panel?.day.date === day.date ? 'is-selected' : undefined}
                    >
                      <th scope="row" className="att-col-date">
                        <span className="att-date-main">{formatDate(day.date, false)}</span>
                        <small className="att-date-weekday">{formatWeekday(day.date)}</small>
                      </th>
                      <td className="att-col-shift">
                        <span className="att-shift-name">
                          {day.templateName ?? t(`schedule.kinds.${day.scheduleKind}`)}
                        </span>
                        {day.scheduledStart && day.scheduledEnd && (
                          <small className="att-shift-time">
                            <bdi>
                              {timeOnly(day.scheduledStart)}–{timeOnly(day.scheduledEnd)}
                            </bdi>
                          </small>
                        )}
                      </td>
                      <td>{timeCell(day, day.punchIn)}</td>
                      <td>{timeCell(day, day.punchOut)}</td>
                      <td>
                        {day.hours === null ? (
                          <span className="att-muted">—</span>
                        ) : (
                          <span className="att-num">{duration(Math.round(day.hours * 60))}</span>
                        )}
                      </td>
                      <td>{minutesCell(day.lateMinutes, 'warn')}</td>
                      <td>{minutesCell(day.earlyLeaveMinutes, 'warn')}</td>
                      <td>{minutesCell(day.overtimeMinutes, 'good')}</td>
                      <td className="att-col-status">
                        <div className="att-status-stack">
                          <span className={`att-chip att-chip-${day.status.toLowerCase()}`}>
                            {t(`attendance.statuses.${day.status}`)}
                          </span>
                          {day.corrected && (
                            <span className="att-edited" title={day.correctionReasons.join(' · ')}>
                              {t('attendance.edited')}
                            </span>
                          )}
                          {day.flags.map((flag) => (
                            <small className="att-flag" key={flag}>
                              {t(`attendance.flags.${flag}`)}
                            </small>
                          ))}
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="att-col-actions">
                          <div className="att-row-actions">
                            <button
                              type="button"
                              className="att-icon-btn att-icon-in"
                              title={t('attendance.correctIn')}
                              aria-label={`${t('attendance.correctIn')} · ${day.date}`}
                              onClick={() => openPanel(day, 'in', false)}
                            >
                              <CheckInIcon />
                            </button>
                            <button
                              type="button"
                              className="att-icon-btn att-icon-out"
                              title={t('attendance.correctOut')}
                              aria-label={`${t('attendance.correctOut')} · ${day.date}`}
                              onClick={() => openPanel(day, 'out', false)}
                            >
                              <CheckOutIcon />
                            </button>
                            <button
                              type="button"
                              className="att-icon-btn att-icon-edit"
                              title={t('attendance.editDay')}
                              aria-label={`${t('attendance.editDay')} · ${day.date}`}
                              onClick={() => openPanel(day, 'in', true)}
                            >
                              <EditIcon />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card att-table-wrap">
              <table className="att-table att-overtime">
                <thead>
                  <tr>
                    <th scope="col" className="att-col-date">
                      {t('attendance.date')}
                    </th>
                    <th scope="col" className="att-col-shift">
                      {t('attendance.shift')}
                    </th>
                    <th scope="col">{t('attendance.scheduledOut')}</th>
                    <th scope="col">{t('attendance.actualOut')}</th>
                    <th scope="col">{t('attendance.overtime')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.summary.overtimeDates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="att-empty">
                        {t('attendance.noOvertime')}
                      </td>
                    </tr>
                  ) : (
                    report.summary.overtimeDates.map((entry) => {
                      const day = report.days.find((item) => item.date === entry.date);
                      return (
                        <tr key={entry.date}>
                          <th scope="row" className="att-col-date">
                            {formatDate(entry.date, true)}
                          </th>
                          <td className="att-col-shift">
                            {day?.templateName ??
                              t(`schedule.kinds.${day?.scheduleKind ?? 'NO_SCHEDULE'}`)}
                          </td>
                          <td>
                            <bdi>{timeOnly(entry.scheduledEnd)}</bdi>
                          </td>
                          <td>
                            <span className="att-time">
                              <bdi>{timeOnly(entry.actualOut)}</bdi>
                              {isNextDay(entry.date, entry.actualOut) && (
                                <span className="att-next-day" title={t('attendance.nextDay')}>
                                  <bdi>+1</bdi>
                                </span>
                              )}
                            </span>
                          </td>
                          <td>
                            <span className="att-num att-num-good">{duration(entry.minutes)}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};
