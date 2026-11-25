import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarDayDto, EmployeeDto, ShiftTemplateDto } from '../../shared/ipc';
import { EmployeeDeleteDialog } from './EmployeeDeleteDialog';
import { EmployeeForm } from './EmployeeForm';
import { ShiftForm } from './ShiftForm';
import { ShiftTimeline, timelineRange, type TimelineShape } from './ShiftTimeline';
import {
  errorText,
  initials,
  minuteLabel,
  money,
  outZoneEnd,
  syntheticEmployees,
  syntheticTemplates,
} from './workforceShared';

interface ScreenProps {
  isAdmin: boolean;
}

const cairoToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

type Notice = { tone: 'success' | 'danger'; text: string } | null;

const NoticeBar = ({ notice, onClose }: { notice: Notice; onClose: () => void }) => {
  const { t } = useTranslation();
  if (!notice) return null;
  return (
    <div className={`wf-alert ${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button
        type="button"
        className="wf-icon-button"
        onClick={onClose}
        aria-label={t('common.close')}
      >
        ×
      </button>
    </div>
  );
};

export const EmployeesScreen = ({ isAdmin }: ScreenProps): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const today = useMemo(cairoToday, []);
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [templates, setTemplates] = useState<readonly ShiftTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [editor, setEditor] = useState<{ employee: EmployeeDto | null } | null>(null);
  const [deleting, setDeleting] = useState<EmployeeDto | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const load = useCallback(async (): Promise<void> => {
    if (!window.dawam) {
      setEmployees(syntheticEmployees);
      setTemplates(syntheticTemplates);
      setLoading(false);
      return;
    }
    const [result, templateResult] = await Promise.all([
      window.dawam.workforce.listEmployees(),
      window.dawam.workforce.listTemplates(),
    ]);
    if (result.ok) {
      setEmployees(result.value);
      const entries = await Promise.all(
        result.value
          .filter((employee) => employee.hasPhoto)
          .map(async (employee) => {
            const photo = await window.dawam!.workforce.getEmployeePhoto({
              employeeId: employee.id,
            });
            return photo.ok && photo.value
              ? ([
                  employee.id,
                  `data:${photo.value.mimeType};base64,${photo.value.dataBase64}`,
                ] as const)
              : null;
          }),
      );
      const urls: Record<number, string> = {};
      for (const entry of entries) if (entry) urls[entry[0]] = entry[1];
      setPhotoUrls(urls);
    } else setNotice({ tone: 'danger', text: errorText(result.error, t) });
    if (templateResult.ok) setTemplates(templateResult.value);
    else setNotice({ tone: 'danger', text: errorText(templateResult.error, t) });
    setLoading(false);
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const setEmployeeActive = async (item: EmployeeDto, active: boolean): Promise<void> => {
    if (!window.dawam) return;
    if (!active && !window.confirm(t('employees.archiveConfirm', { name: item.fullName }))) return;
    const result = await window.dawam.workforce.updateEmployee({
      id: item.id,
      fullName: item.fullName,
      deviceUserId: item.deviceUserId,
      hireDate: item.hireDate,
      active,
      monthlySalaryMinor: item.monthlySalaryMinor ?? null,
      wageBasisDays: item.wageBasisDays ?? 30,
      reason: active ? 'Employee reactivated' : 'Employee archived',
    });
    if (!result.ok) setNotice({ tone: 'danger', text: errorText(result.error, t) });
    else {
      setNotice({
        tone: 'success',
        text: active ? t('employees.reactivated') : t('employees.archived'),
      });
      await load();
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = employees.filter(
    (item) =>
      (statusFilter === 'all' || (statusFilter === 'active') === item.active) &&
      (!needle ||
        item.fullName.toLowerCase().includes(needle) ||
        item.deviceUserId.includes(needle)),
  );
  const activeCount = employees.filter((item) => item.active).length;

  return (
    <section className="module-screen wf-screen wf-employees">
      <header className="wf-head">
        <div>
          <span className="wf-eyebrow">{t('employees.eyebrow')}</span>
          <h1>{t('employees.title')}</h1>
          <p>{t('employees.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="wf-button primary"
            onClick={() => setEditor({ employee: null })}
          >
            + {t('employees.add')}
          </button>
        )}
      </header>
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <div className="wf-toolbar">
        <input
          type="search"
          className="wf-search"
          placeholder={t('wf.employees.search')}
          aria-label={t('wf.employees.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wf-segmented" role="group" aria-label={t('employees.status')}>
          {(['all', 'active', 'inactive'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={statusFilter === value}
              className={statusFilter === value ? 'on' : ''}
              onClick={() => setStatusFilter(value)}
            >
              {t(`wf.employees.filter.${value}`)}
            </button>
          ))}
        </div>
        <span className="wf-count">
          {t('wf.employees.count', { active: activeCount, total: employees.length })}
        </span>
      </div>
      <div className="wf-card wf-table-wrap">
        {loading ? (
          <div className="wf-empty">{t('common.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="wf-empty">
            {employees.length === 0 ? t('employees.empty') : t('wf.employees.noMatch')}
          </div>
        ) : (
          <table className="wf-table">
            <thead>
              <tr>
                <th>{t('employees.employee')}</th>
                <th>{t('employees.deviceId')}</th>
                <th>{t('employees.hireDate')}</th>
                <th>{t('employees.status')}</th>
                {isAdmin && <th>{t('employees.salary')}</th>}
                {isAdmin && <th className="wf-actions-col">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className={item.active ? '' : 'inactive'}>
                  <td>
                    <div className="wf-person">
                      <span className="wf-avatar">
                        {photoUrls[item.id] ? (
                          <img src={photoUrls[item.id]} alt="" />
                        ) : (
                          initials(item.fullName)
                        )}
                      </span>
                      <strong>{item.fullName}</strong>
                    </div>
                  </td>
                  <td>
                    <code className="wf-device-id" dir="ltr">
                      {item.deviceUserId}
                    </code>
                  </td>
                  <td>
                    <bdi>{item.hireDate ?? '—'}</bdi>
                  </td>
                  <td>
                    <span className={`wf-pill ${item.active ? 'ok' : 'off'}`}>
                      {item.active ? t('employees.active') : t('employees.inactive')}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="wf-num">
                      {item.monthlySalaryMinor == null
                        ? '—'
                        : money(item.monthlySalaryMinor, i18n.resolvedLanguage ?? 'ar')}
                    </td>
                  )}
                  {isAdmin && (
                    <td>
                      <div className="wf-row-actions">
                        <button
                          type="button"
                          className="wf-button ghost small"
                          onClick={() => setEditor({ employee: item })}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className={`wf-button small ${item.active ? 'ghost' : 'soft'}`}
                          onClick={() => void setEmployeeActive(item, !item.active)}
                        >
                          {item.active ? t('employees.archive') : t('employees.reactivate')}
                        </button>
                        <button
                          type="button"
                          className="wf-button danger-ghost small"
                          onClick={() => setDeleting(item)}
                        >
                          {t('employees.deletePermanently')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editor && (
        <EmployeeForm
          employee={editor.employee}
          employees={employees}
          templates={templates}
          currentPhotoUrl={editor.employee ? photoUrls[editor.employee.id] : undefined}
          today={today}
          onClose={() => setEditor(null)}
          onSaved={(text) => {
            setEditor(null);
            setNotice({ tone: 'success', text });
            void load();
          }}
        />
      )}
      {deleting && (
        <EmployeeDeleteDialog
          employee={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(text) => {
            setDeleting(null);
            setNotice({ tone: 'success', text });
            void load();
          }}
        />
      )}
    </section>
  );
};

const templateShape = (item: ShiftTemplateDto): TimelineShape => ({
  startMin: item.startMin,
  endMin: item.endMin,
  inFromMin: item.inFromMin,
  inToMin: item.inToMin,
  outFromMin: item.endMin - item.checkoutOpenBeforeEndMin,
  outEndMin: outZoneEnd(item),
  lateGraceMin: item.lateGraceMin,
  openEnded: item.outToMin === null,
});

export const ShiftsScreen = ({ isAdmin }: ScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<readonly ShiftTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ template: ShiftTemplateDto | null } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const load = useCallback(async (): Promise<void> => {
    if (!window.dawam) {
      setTemplates(syntheticTemplates);
      setLoading(false);
      return;
    }
    const result = await window.dawam.workforce.listTemplates();
    if (result.ok) setTemplates(result.value);
    else setNotice({ tone: 'danger', text: errorText(result.error, t) });
    setLoading(false);
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const shapes = templates.map(templateShape);
  const range = timelineRange(shapes);

  return (
    <section className="module-screen wf-screen wf-shifts">
      <header className="wf-head">
        <div>
          <span className="wf-eyebrow">{t('shifts.eyebrow')}</span>
          <h1>{t('shifts.title')}</h1>
          <p>{t('shifts.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="wf-button primary"
            onClick={() => setEditor({ template: null })}
          >
            + {t('shifts.add')}
          </button>
        )}
      </header>
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <p className="wf-intro">{t('wf.shifts.intro')}</p>
      {loading ? (
        <div className="wf-card wf-empty">{t('common.loading')}</div>
      ) : templates.length === 0 ? (
        <div className="wf-card wf-empty">{t('wf.shifts.empty')}</div>
      ) : (
        <div className="wf-shift-list">
          {templates.map((item, index) => {
            const shape = shapes[index]!;
            const duration = item.endMin - item.startMin;
            return (
              <article
                className={`wf-card wf-shift-card${item.active ? '' : ' inactive'}`}
                key={item.id}
              >
                <div className="wf-shift-card-head">
                  <div className="wf-shift-title">
                    <h2>{item.name}</h2>
                    <span className={`wf-pill ${item.active ? 'ok' : 'off'}`}>
                      {item.active ? t('shifts.active') : t('shifts.inactive')}
                    </span>
                  </div>
                  <div className="wf-shift-hours">
                    <bdi className="wf-time big">
                      {minuteLabel(item.startMin)} → {minuteLabel(item.endMin)}
                    </bdi>
                    <span className="wf-muted">
                      {t('wf.shiftForm.duration', {
                        hours: Math.floor(duration / 60),
                        minutes: String(duration % 60).padStart(2, '0'),
                      })}
                    </span>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      className="wf-button ghost small"
                      onClick={() => setEditor({ template: item })}
                    >
                      {t('common.edit')}
                    </button>
                  )}
                </div>
                <ShiftTimeline shape={shape} range={range} compact />
                <dl className="wf-facts">
                  <div>
                    <dt>{t('shifts.inWindow')}</dt>
                    <dd>
                      <bdi>
                        {minuteLabel(item.inFromMin)} – {minuteLabel(item.inToMin)}
                      </bdi>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('shifts.outWindow')}</dt>
                    <dd>
                      <bdi>
                        {minuteLabel(shape.outFromMin)} –{' '}
                        {item.outToMin === null
                          ? `${minuteLabel(shape.outEndMin)} (${t('wf.timeline.openEnded')})`
                          : minuteLabel(item.outToMin)}
                      </bdi>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('shifts.lateGrace')}</dt>
                    <dd>{t('wf.shifts.minutes', { count: item.lateGraceMin })}</dd>
                  </div>
                  {item.outToMin === null && (
                    <div>
                      <dt>{t('shifts.overtimeCap')}</dt>
                      <dd>{t('wf.shifts.minutes', { count: item.otCapMin })}</dd>
                    </div>
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      )}
      {editor && (
        <ShiftForm
          template={editor.template}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setNotice({ tone: 'success', text: t('wf.shiftForm.saved') });
            void load();
          }}
        />
      )}
    </section>
  );
};

const KINDS = ['SHIFT', 'COVERAGE', 'REST', 'COVERAGE_NEEDED', 'NO_SCHEDULE'] as const;

const syntheticCalendar = (month: string, seed: number): CalendarDayDto[] => {
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const slot = (i + seed) % 7;
    const kind: CalendarDayDto['kind'] =
      slot === 5
        ? 'REST'
        : slot === 6
          ? 'COVERAGE'
          : slot === 3 && i > 20
            ? 'COVERAGE_NEEDED'
            : 'SHIFT';
    return {
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
      kind,
      source: kind === 'REST' ? 'weekly_rest' : 'assignment',
      ...(kind === 'SHIFT' || kind === 'COVERAGE'
        ? { templateName: kind === 'COVERAGE' ? 'Morning + Evening' : 'Morning' }
        : {}),
    };
  });
};

const dayLabel = (day: CalendarDayDto, t: (key: string) => string): string =>
  day.leaveKind ? t(`schedule.${day.leaveKind}`) : t(`schedule.kinds.${day.kind}`);

export const ScheduleScreen = (): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const today = cairoToday();
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [view, setView] = useState<'team' | 'employee'>('team');
  const [selected, setSelected] = useState(0);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [calendars, setCalendars] = useState<Record<number, readonly CalendarDayDto[]>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const loadBase = async (): Promise<void> => {
      if (!window.dawam) {
        setEmployees(syntheticEmployees.filter((item) => item.active));
        setSelected(syntheticEmployees[0]!.id);
        return;
      }
      const people = await window.dawam.workforce.listEmployees();
      if (people.ok) {
        const active = people.value.filter((item) => item.active);
        setEmployees(active);
        setSelected((current) => current || active[0]?.id || 0);
      } else setMessage(errorText(people.error, t));
    };
    void loadBase();
  }, [t]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let cancelled = false;
    const ids = view === 'team' ? employees.map((item) => item.id) : selected ? [selected] : [];
    const load = async (): Promise<void> => {
      setLoading(true);
      const next: Record<number, readonly CalendarDayDto[]> = {};
      if (!window.dawam) {
        ids.forEach((id) => (next[id] = syntheticCalendar(month, id)));
      } else {
        const results = await Promise.all(
          ids.map((employeeId) => window.dawam!.workforce.calendar({ employeeId, month })),
        );
        results.forEach((result, index) => {
          if (result.ok) next[ids[index]!] = result.value;
          else setMessage(errorText(result.error, t));
        });
      }
      if (!cancelled) {
        setCalendars(next);
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [employees, selected, month, view, t]);

  const locale = i18n.resolvedLanguage === 'en' ? 'en-EG' : 'ar-EG';
  const weekday = (date: string, style: 'short' | 'narrow' = 'short') =>
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`),
    );
  const isWeekend = (date: string) => [5, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const monthDays = Object.values(calendars)[0]?.map((day) => day.date) ?? [];
  const selectedDays = calendars[selected] ?? [];
  const summary = (days: readonly CalendarDayDto[]) =>
    KINDS.map((kind) => ({ kind, count: days.filter((day) => day.kind === kind).length }));

  return (
    <section className="module-screen wf-screen wf-schedule">
      <header className="wf-head">
        <div>
          <span className="wf-eyebrow">{t('schedule.eyebrow')}</span>
          <h1>{t('schedule.title')}</h1>
          <p>{t('schedule.subtitle')}</p>
        </div>
        <div className="wf-head-controls">
          <div className="wf-segmented" role="group" aria-label={t('wf.schedule.view')}>
            {(['team', 'employee'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                className={view === value ? 'on' : ''}
                onClick={() => setView(value)}
              >
                {t(`wf.schedule.views.${value}`)}
              </button>
            ))}
          </div>
          {view === 'employee' && (
            <select
              aria-label={t('employees.employee')}
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {employees.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.fullName}
                </option>
              ))}
            </select>
          )}
          <input
            type="month"
            aria-label={t('wf.schedule.month')}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </header>
      {message && (
        <div className="wf-alert danger" role="alert">
          {message}
        </div>
      )}
      <div className="wf-legend-bar">
        <ul className="wf-legend" aria-label={t('wf.schedule.legend')}>
          {KINDS.map((kind) => (
            <li key={kind} className={`wf-kind ${kind.toLowerCase()}`}>
              <i />
              {t(`schedule.kinds.${kind}`)}
            </li>
          ))}
          <li className="wf-kind leave">
            <i />
            {t('schedule.leave')} / {t('schedule.permission')}
          </li>
        </ul>
        <p className="wf-muted">{t('schedule.manageFromEmployee')}</p>
      </div>

      {employees.length === 0 && !loading ? (
        <div className="wf-card wf-empty">{t('employees.empty')}</div>
      ) : view === 'team' ? (
        <div className="wf-card wf-team-wrap" aria-busy={loading}>
          <table className="wf-team">
            <thead>
              <tr>
                <th className="wf-corner" scope="col">
                  {t('employees.employee')}
                </th>
                {monthDays.map((date) => (
                  <th
                    key={date}
                    scope="col"
                    className={`${isWeekend(date) ? 'weekend' : ''}${date === today ? ' today' : ''}`}
                  >
                    <span>{weekday(date, 'short')}</span>
                    <b>{Number(date.slice(-2))}</b>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((item) => {
                const days = calendars[item.id] ?? [];
                const needed = days.filter((day) => day.kind === 'COVERAGE_NEEDED').length;
                return (
                  <tr key={item.id}>
                    <th scope="row" className="wf-row-head">
                      <button
                        type="button"
                        className="wf-row-link"
                        onClick={() => {
                          setSelected(item.id);
                          setView('employee');
                        }}
                      >
                        <strong>{item.fullName}</strong>
                        <small>
                          <code dir="ltr">{item.deviceUserId}</code>
                          {needed > 0 && (
                            <em className="wf-needed-count">
                              {t('wf.schedule.neededCount', { count: needed })}
                            </em>
                          )}
                        </small>
                      </button>
                    </th>
                    {days.map((day) => (
                      <td
                        key={day.date}
                        className={`wf-kind ${day.kind.toLowerCase()}${day.leaveKind ? ' leave' : ''}${day.date === today ? ' today' : ''}`}
                        title={`${day.date} · ${dayLabel(day, t)}${day.templateName ? ` · ${day.templateName}` : ''}`}
                      >
                        <span className="wf-cell-label">
                          {t(`wf.schedule.short.${day.leaveKind ?? day.kind}`)}
                        </span>
                        <span className="wf-visually-hidden">{dayLabel(day, t)}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="wf-summary">
            {summary(selectedDays).map(({ kind, count }) => (
              <div key={kind} className={`wf-kind ${kind.toLowerCase()}`}>
                <i />
                <span>{t(`schedule.kinds.${kind}`)}</span>
                <b>{count}</b>
              </div>
            ))}
          </div>
          <div className="wf-calendar" aria-busy={loading}>
            {[
              '2024-01-06',
              '2024-01-07',
              '2024-01-08',
              '2024-01-09',
              '2024-01-10',
              '2024-01-11',
              '2024-01-12',
            ].map((date) => (
              <div className="wf-calendar-weekday" key={date} aria-hidden="true">
                {weekday(date, 'short')}
              </div>
            ))}
            {selectedDays.map((day, index) => (
              <article
                key={day.date}
                className={`wf-day wf-kind ${day.kind.toLowerCase()}${day.leaveKind ? ' leave' : ''}${day.date === today ? ' today' : ''}`}
                style={
                  index === 0
                    ? {
                        gridColumnStart:
                          ((new Date(`${day.date}T12:00:00Z`).getUTCDay() + 1) % 7) + 1,
                      }
                    : undefined
                }
              >
                <header>
                  <strong>{Number(day.date.slice(-2))}</strong>
                  <span>{weekday(day.date)}</span>
                </header>
                <span className="wf-day-chip">{dayLabel(day, t)}</span>
                {day.templateName && <small className="wf-day-shift">{day.templateName}</small>}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
