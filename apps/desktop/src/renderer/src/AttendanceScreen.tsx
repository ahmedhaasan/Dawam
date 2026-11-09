import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const [correction, setCorrection] = useState<{
    day: AttendanceDayDto;
    field: 'in' | 'out';
    time: string;
    reason: string;
  } | null>(null);
  const [exception, setException] = useState<{
    day: AttendanceDayDto;
    kind: 'shift' | 'rest' | 'work_default' | 'cancel_coverage';
    templateId: string;
    reason: string;
  } | null>(null);

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
    setEmployeeId((current) => current || String(active[0]?.id ?? ''));
    if (templateResult.ok) setTemplates(templateResult.value);
    setLoading(false);
  };

  useEffect(() => {
    void loadEmployees();
  }, []);

  const loadMonth = async (): Promise<void> => {
    if (!window.dawam || !employeeId) {
      setReport(null);
      return;
    }
    setLoading(true);
    setMessage('');
    const result = await window.dawam.attendance.month({ employeeId: Number(employeeId), month });
    if (result.ok) setReport(result.value);
    else {
      setReport(null);
      setMessage(t(result.error.messageKey));
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadMonth();
  }, [employeeId, month]);

  const totals = useMemo(() => {
    const counts = report?.summary.statusCounts ?? {};
    return {
      present: counts.PRESENT ?? 0,
      absent: counts.ABSENT ?? 0,
      pending:
        (counts.PENDING_IMPORT ?? 0) +
        (counts.NOT_CLOSED ?? 0) +
        (counts.REVIEW ?? 0) +
        (counts.MISSING_IN ?? 0) +
        (counts.MISSING_OUT ?? 0),
    };
  }, [report]);

  const openCorrection = (day: AttendanceDayDto, field: 'in' | 'out'): void => {
    const existing = field === 'in' ? day.punchIn : day.punchOut;
    setCorrection({
      day,
      field,
      time: inputDateTime(existing ?? `${day.date} 10:00:00`),
      reason: '',
    });
  };

  const saveCorrection = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!window.dawam || !correction) return;
    setMessage('');
    const result = await window.dawam.attendance.correct({
      employeeId: Number(employeeId),
      shiftDate: correction.day.date,
      field: correction.field,
      newTimeLocal: correction.time ? apiDateTime(correction.time) : null,
      reason: correction.reason,
    });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return;
    }
    setCorrection(null);
    setMessage(t('attendance.correctionSaved'));
    await loadMonth();
  };

  const saveException = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!window.dawam || !exception) return;
    const result = await window.dawam.workforce.setOverride({
      employeeId: Number(employeeId),
      date: exception.day.date,
      kind: exception.kind,
      ...(exception.kind === 'shift' ? { templateId: Number(exception.templateId) } : {}),
      reason: exception.reason,
    });
    if (!result.ok) {
      setMessage(t(result.error.messageKey));
      return;
    }
    setException(null);
    setMessage(t('attendance.exceptionSaved'));
    await loadMonth();
  };

  const lateDuration = (minutes: number): string =>
    t('attendance.lateDuration', {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    });

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

  return (
    <section className="module-screen attendance-screen">
      <div className="module-header">
        <div>
          <span className="eyebrow">{t('attendance.eyebrow')}</span>
          <h1>{t('attendance.title')}</h1>
          <p>{t('attendance.subtitle')}</p>
        </div>
        <div className="attendance-actions">
          <button type="button" onClick={exportCsv} disabled={!report}>
            {t('attendance.exportCsv')}
          </button>
          <button type="button" onClick={printReport} disabled={!report}>
            {t('attendance.printPdf')}
          </button>
        </div>
      </div>

      <div className="card attendance-filters">
        <label>
          <span>{t('employees.employee')}</span>
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} · {employee.deviceUserId}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('attendance.month')}</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <div className="coverage-rule">
          <strong>{t('attendance.safeAbsence')}</strong>
          <span>{t('attendance.safeAbsenceDetail')}</span>
        </div>
      </div>

      {message && <div className="success-note">{message}</div>}
      {loading && <div className="card empty-state">{t('common.loading')}</div>}
      {!loading && employees.length === 0 && (
        <div className="card empty-state">{t('attendance.noEmployees')}</div>
      )}
      {!loading && report && (
        <>
          <div className="print-report-identity card">
            <div>
              <span>{t('attendance.employeeReport')}</span>
              <strong>{report.employee.fullName}</strong>
            </div>
            <div>
              <span>{t('employees.deviceId')}</span>
              <strong>{report.employee.deviceUserId}</strong>
            </div>
            <div>
              <span>{t('attendance.month')}</span>
              <strong>{month}</strong>
            </div>
          </div>
          <div className="attendance-summary">
            <article className="card">
              <span>{t('attendance.present')}</span>
              <strong>{totals.present}</strong>
            </article>
            <article className="card danger">
              <span>{t('attendance.absent')}</span>
              <strong>{totals.absent}</strong>
            </article>
            <article className="card warning">
              <span>{t('attendance.pending')}</span>
              <strong>{totals.pending}</strong>
            </article>
            <article className="card">
              <span>{t('attendance.totalLate')}</span>
              <strong>{lateDuration(report.summary.totalLateMinutes)}</strong>
            </article>
          </div>

          {correction && (
            <form className="card correction-form" onSubmit={(event) => void saveCorrection(event)}>
              <div>
                <strong>{t('attendance.correctPunch')}</strong>
                <span>
                  {correction.day.date} · {t(`attendance.fields.${correction.field}`)}
                </span>
              </div>
              <label>
                <span>{t('attendance.correctedTime')}</span>
                <input
                  type="datetime-local"
                  value={correction.time}
                  onChange={(event) => setCorrection({ ...correction, time: event.target.value })}
                />
              </label>
              <label className="correction-reason">
                <span>{t('common.reason')}</span>
                <input
                  value={correction.reason}
                  onChange={(event) => setCorrection({ ...correction, reason: event.target.value })}
                  required
                />
              </label>
              <button className="module-primary" type="submit">
                {t('common.save')}
              </button>
              <button className="table-edit" type="button" onClick={() => setCorrection(null)}>
                {t('common.close')}
              </button>
            </form>
          )}

          {exception && (
            <form className="card correction-form" onSubmit={(event) => void saveException(event)}>
              <div>
                <strong>{t('attendance.dayException')}</strong>
                <span>{exception.day.date}</span>
              </div>
              <label>
                <span>{t('attendance.exceptionType')}</span>
                <select
                  value={exception.kind}
                  onChange={(event) =>
                    setException({
                      ...exception,
                      kind: event.target.value as typeof exception.kind,
                    })
                  }
                >
                  <option value="shift">{t('schedule.forceShift')}</option>
                  <option value="rest">{t('schedule.forceRest')}</option>
                  <option value="work_default">{t('schedule.forceWork')}</option>
                  <option value="cancel_coverage">{t('schedule.cancelCoverage')}</option>
                </select>
              </label>
              {exception.kind === 'shift' && (
                <label>
                  <span>{t('schedule.template')}</span>
                  <select
                    value={exception.templateId}
                    onChange={(event) =>
                      setException({ ...exception, templateId: event.target.value })
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
              <label className="correction-reason">
                <span>{t('attendance.exceptionReason')}</span>
                <input
                  required
                  value={exception.reason}
                  onChange={(event) => setException({ ...exception, reason: event.target.value })}
                />
              </label>
              <button className="module-primary" type="submit">
                {t('common.save')}
              </button>
              <button className="table-edit" type="button" onClick={() => setException(null)}>
                {t('common.close')}
              </button>
            </form>
          )}

          <div className="card table-card attendance-table">
            <table>
              <thead>
                <tr>
                  <th>{t('attendance.date')}</th>
                  <th>{t('attendance.shift')}</th>
                  <th>{t('attendance.in')}</th>
                  <th>{t('attendance.out')}</th>
                  <th>{t('attendance.hours')}</th>
                  <th>{t('attendance.late')}</th>
                  <th>{t('attendance.early')}</th>
                  <th>{t('attendance.status')}</th>
                  {isAdmin && <th>{t('common.edit')}</th>}
                </tr>
              </thead>
              <tbody>
                {report.days.map((day) => (
                  <tr key={day.date}>
                    <td>
                      {new Intl.DateTimeFormat(locale, {
                        day: '2-digit',
                        month: 'short',
                        timeZone: 'UTC',
                      }).format(new Date(`${day.date}T12:00:00Z`))}
                    </td>
                    <td>{day.templateName ?? t(`schedule.kinds.${day.scheduleKind}`)}</td>
                    <td className="attendance-time">{timeOnly(day.punchIn)}</td>
                    <td className="attendance-time">{timeOnly(day.punchOut)}</td>
                    <td>{day.hours === null ? '—' : day.hours.toFixed(2)}</td>
                    <td>{day.lateMinutes === null ? '—' : lateDuration(day.lateMinutes)}</td>
                    <td>
                      {day.earlyLeaveMinutes === null ? '—' : lateDuration(day.earlyLeaveMinutes)}
                    </td>
                    <td>
                      <span className={`attendance-status status-${day.status.toLowerCase()}`}>
                        {t(`attendance.statuses.${day.status}`)}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="correction-buttons">
                        <button type="button" onClick={() => openCorrection(day, 'in')}>
                          {t('attendance.correctIn')}
                        </button>
                        <button type="button" onClick={() => openCorrection(day, 'out')}>
                          {t('attendance.correctOut')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setException({
                              day,
                              kind: 'rest',
                              templateId: String(templates[0]?.id ?? ''),
                              reason: '',
                            })
                          }
                        >
                          {t('attendance.dayException')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
