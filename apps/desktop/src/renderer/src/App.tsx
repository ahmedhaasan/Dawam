import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SessionDto } from '../../shared/ipc';

import { applyDocumentLanguage, type SupportedLanguage } from './i18n';
import { AttendanceScreen } from './AttendanceScreen';
import { ImportWizard } from './ImportWizard';
import { PayrollScreen } from './PayrollScreen';
import { SettingsScreen } from './SettingsScreen';
import { EmployeesScreen, ScheduleScreen, ShiftsScreen } from './WorkforceScreens';
import eltyarLogo from './assets/eltyar-logo.png';

type IconName =
  | 'home'
  | 'people'
  | 'clock'
  | 'calendar'
  | 'table'
  | 'wallet'
  | 'settings'
  | 'upload'
  | 'check'
  | 'warning';

const Icon = ({ name }: { name: IconName }): React.JSX.Element => {
  const paths: Record<IconName, React.JSX.Element> = {
    home: <path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z" />,
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    table: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M9 9v11" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M16 12h6v4h-6a2 2 0 0 1 0-4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.55-1H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-1.55V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 15v5h16v-5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    warning: (
      <>
        <path d="M10.3 3.6 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
};

const navItems: Array<{ key: string; icon: IconName }> = [
  { key: 'home', icon: 'home' },
  { key: 'employees', icon: 'people' },
  { key: 'shifts', icon: 'clock' },
  { key: 'schedule', icon: 'calendar' },
  { key: 'attendance', icon: 'table' },
  { key: 'payroll', icon: 'wallet' },
];

type ModuleKey =
  'home' | 'employees' | 'shifts' | 'schedule' | 'attendance' | 'payroll' | 'settings';

interface DashboardProps {
  session: SessionDto;
  onLogout: () => Promise<void>;
}

const Dashboard = ({ session, onLogout }: DashboardProps): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const language = (i18n.resolvedLanguage === 'en' ? 'en' : 'ar') as SupportedLanguage;
  const [activeModule, setActiveModule] = useState<ModuleKey>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('dawam.sidebarCollapsed') === '1',
  );
  const toggleSidebar = (): void => {
    setSidebarCollapsed((value) => {
      window.localStorage.setItem('dawam.sidebarCollapsed', value ? '0' : '1');
      return !value;
    });
  };
  const [profilePhoto, setProfilePhoto] = useState('');
  const [overview, setOverview] = useState({
    employees: 0,
    activeEmployees: 0,
    present: 0,
    late: 0,
    pending: 0,
    shifts: [] as Array<{
      name: string;
      time: string;
      count: number;
      coverageNeeded: boolean;
    }>,
  });

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeModule]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel'];
    const arm = async (): Promise<void> => {
      if (!window.dawam) return;
      const result = await window.dawam.settings.getIdleLockMinutes();
      if (!result.ok || disposed || result.value === 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void onLogout(), result.value * 60_000);
    };
    const reset = (): void => void arm();
    for (const event of events) window.addEventListener(event, reset, { passive: true });
    void arm();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, reset);
    };
  }, [onLogout]);

  useEffect(() => {
    const loadProfilePhoto = async (): Promise<void> => {
      if (!window.dawam || !session.hasPhoto) return;
      const result = await window.dawam.users.getPhoto({ userId: session.id });
      if (result.ok && result.value) {
        setProfilePhoto(`data:${result.value.mimeType};base64,${result.value.dataBase64}`);
      }
    };
    void loadProfilePhoto();
  }, [session.hasPhoto, session.id]);

  useEffect(() => {
    const loadOverview = async (): Promise<void> => {
      if (activeModule !== 'home') return;
      if (!window.dawam) return;
      const [employeesResult, templatesResult] = await Promise.all([
        window.dawam.workforce.listEmployees(),
        window.dawam.workforce.listTemplates(),
      ]);
      if (!employeesResult.ok || !templatesResult.ok) return;
      const employees = employeesResult.value.filter((employee) => employee.active);
      const month = today.slice(0, 7);
      const records = await Promise.all(
        employees.map(async (employee) => ({
          attendance: await window.dawam!.attendance.month({ employeeId: employee.id, month }),
          calendar: await window.dawam!.workforce.calendar({ employeeId: employee.id, month }),
        })),
      );
      let present = 0;
      let late = 0;
      let pending = 0;
      const groups = new Map<
        string,
        { name: string; time: string; count: number; coverageNeeded: boolean }
      >();
      for (const record of records) {
        if (record.attendance.ok) {
          const day = record.attendance.value.days.find((item) => item.date === today);
          if (day?.status === 'PRESENT' || day?.status === 'EARLY_LEAVE') present += 1;
          if ((day?.lateMinutes ?? 0) > 0) late += 1;
          if (
            day &&
            [
              'MISSING_IN',
              'MISSING_OUT',
              'PENDING_IMPORT',
              'NOT_CLOSED',
              'REVIEW',
              'COVERAGE_NEEDED',
            ].includes(day.status)
          )
            pending += 1;
        }
        if (!record.calendar.ok) continue;
        const day = record.calendar.value.find((item) => item.date === today);
        if (!day || !['SHIFT', 'COVERAGE', 'COVERAGE_NEEDED'].includes(day.kind)) continue;
        const coverageNeeded = day.kind === 'COVERAGE_NEEDED';
        const name = coverageNeeded
          ? t('home.coverageNeeded')
          : (day.templateName ?? t('schedule.kinds.SHIFT'));
        const template = templatesResult.value.find((item) => item.name === day.templateName);
        const start = template?.startMin ?? 0;
        const time = coverageNeeded
          ? '—'
          : `${String(Math.floor((start % 1440) / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
        const key = `${name}:${time}:${coverageNeeded}`;
        const group = groups.get(key);
        if (group) group.count += 1;
        else groups.set(key, { name, time, count: 1, coverageNeeded });
      }
      setOverview({
        employees: employeesResult.value.length,
        activeEmployees: employees.length,
        present,
        late,
        pending,
        shifts: [...groups.values()],
      });
    };
    void loadOverview();
  }, [activeModule, today, t]);

  const toggleLanguage = async (): Promise<void> => {
    const nextLanguage: SupportedLanguage = language === 'ar' ? 'en' : 'ar';
    await i18n.changeLanguage(nextLanguage);
    applyDocumentLanguage(nextLanguage);
    if (window.dawam) await window.dawam.settings.setLanguage(nextLanguage);
  };

  const stats = [
    {
      key: 'employees',
      value: String(overview.employees),
      tone: 'blue',
    },
    { key: 'attendance', value: String(overview.present), tone: 'green' },
    { key: 'late', value: String(overview.late), tone: 'amber' },
    { key: 'pending', value: String(overview.pending), tone: 'violet' },
  ];

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={eltyarLogo} alt="" />
          <div>
            <strong>{t('app.name')}</strong>
            <small>{t('app.tagline')}</small>
          </div>
        </div>
        <nav className="nav" aria-label={t('header.workspace')}>
          {navItems.map((item) => (
            <button
              className={activeModule === item.key ? 'nav-item active' : 'nav-item'}
              key={item.key}
              type="button"
              title={t(`nav.${item.key}`)}
              onClick={() => setActiveModule(item.key as ModuleKey)}
            >
              <Icon name={item.icon} />
              <span>{t(`nav.${item.key}`)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={activeModule === 'settings' ? 'nav-item active' : 'nav-item'}
            type="button"
            title={t('nav.settings')}
            onClick={() => setActiveModule('settings')}
          >
            <Icon name="settings" />
            <span>{t('nav.settings')}</span>
          </button>
          <div className="offline">
            <span className="offline-dot"></span>
            {t('common.localOnly')}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={t(sidebarCollapsed ? 'common.expandSidebar' : 'common.collapseSidebar')}
            title={t(sidebarCollapsed ? 'common.expandSidebar' : 'common.collapseSidebar')}
            onClick={toggleSidebar}
          >
            ☰
          </button>
          <div className="workspace-label">{t('header.workspace')}</div>
          <div className="topbar-actions">
            <button className="language-button" type="button" onClick={() => void toggleLanguage()}>
              {t('header.switchLanguage')}
            </button>
            <div className="profile">
              <div className="avatar">
                {profilePhoto ? <img src={profilePhoto} alt="" /> : session.username.slice(0, 1)}
              </div>
              <div>
                <strong>{session.username}</strong>
                <small>{session.role === 'admin' ? t('header.admin') : t('header.user')}</small>
              </div>
            </div>
            <button className="logout-button" type="button" onClick={() => void onLogout()}>
              {t('header.logout')}
            </button>
          </div>
        </header>

        {activeModule === 'employees' && (
          <div className="content">
            <EmployeesScreen isAdmin={session.role === 'admin'} />
          </div>
        )}
        {activeModule === 'shifts' && (
          <div className="content">
            <ShiftsScreen isAdmin={session.role === 'admin'} />
          </div>
        )}
        {activeModule === 'schedule' && (
          <div className="content">
            <ScheduleScreen />
          </div>
        )}
        {activeModule === 'attendance' && (
          <div className="content">
            <AttendanceScreen isAdmin={session.role === 'admin'} />
          </div>
        )}
        {activeModule === 'payroll' && (
          <div className="content">
            <PayrollScreen isAdmin={session.role === 'admin'} />
          </div>
        )}
        {activeModule === 'settings' && (
          <div className="content">
            <SettingsScreen
              session={session}
              onProfileUpdated={(_updatedSession, photoUrl) => setProfilePhoto(photoUrl)}
            />
          </div>
        )}
        {activeModule === 'home' && (
          <section className="content">
            <div className="welcome-row">
              <div>
                <span className="eyebrow">{t('home.eyebrow')}</span>
                <h1>{t('home.greeting', { name: session.username })}</h1>
              </div>
              <div className="date-card">
                <Icon name="calendar" />
                <div>
                  <strong>{today.slice(8, 10)}</strong>
                  <span>
                    {new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', {
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'Africa/Cairo',
                    }).format(new Date(`${today}T12:00:00Z`))}
                  </span>
                </div>
              </div>
            </div>

            <div className="stats-grid">
              {stats.map((stat) => (
                <article className={`stat-card ${stat.tone}`} key={stat.key}>
                  <div className="stat-head">
                    <span>{t(`home.${stat.key}`)}</span>
                  </div>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </div>

            <div className="dashboard-grid">
              <section className="card import-card">
                <div className="import-copy">
                  <h2>{t('home.importTitle')}</h2>
                  <ImportWizard />
                </div>
              </section>

              <section className="card shifts-card">
                <div className="section-heading">
                  <div>
                    <h2>{t('home.upcoming')}</h2>
                  </div>
                  <button type="button" onClick={() => setActiveModule('schedule')}>
                    {t('common.viewAll')}
                  </button>
                </div>
                {overview.shifts.length === 0 && (
                  <div className="empty-dashboard-list">{t('home.noShiftsToday')}</div>
                )}
                {overview.shifts.map((shift) => (
                  <div className="shift-item" key={`${shift.name}-${shift.time}`}>
                    <div className="shift-time morning">{shift.time}</div>
                    <div className="shift-info">
                      <strong>{shift.name}</strong>
                      <span>{t('home.teamMembers', { count: shift.count })}</span>
                    </div>
                    <div className={shift.coverageNeeded ? 'coverage warn' : 'coverage ok'}>
                      <Icon name={shift.coverageNeeded ? 'warning' : 'check'} />
                      {shift.coverageNeeded ? t('home.coverageNeeded') : t('home.scheduled')}
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

interface AccessScreenProps {
  mode: 'setup' | 'login';
  onAuthenticated: (session: SessionDto) => void;
}

const AccessScreen = ({ mode, onAuthenticated }: AccessScreenProps): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const language = (i18n.resolvedLanguage === 'en' ? 'en' : 'ar') as SupportedLanguage;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleLanguage = async (): Promise<void> => {
    const next: SupportedLanguage = language === 'ar' ? 'en' : 'ar';
    await i18n.changeLanguage(next);
    applyDocumentLanguage(next);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!window.dawam) {
      setErrorMessage(t('errors.desktop_api_unavailable'));
      return;
    }
    if (mode === 'setup' && password !== confirmPassword) {
      setErrorMessage(t('access.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      const result =
        mode === 'setup'
          ? await window.dawam.auth.createFirstAdmin({
              username,
              password,
              language,
              timezone: 'Africa/Cairo',
            })
          : await window.dawam.auth.login({ username, password });
      if (result.ok) onAuthenticated(result.value);
      else setErrorMessage(t(result.error.messageKey));
    } catch {
      setErrorMessage(t('errors.unexpected'));
    } finally {
      setSubmitting(false);
    }
  };

  const passwordScore = [
    password.length >= 10,
    /[A-Z]/.test(password) && /[a-z]/.test(password),
    /\d/.test(password),
  ].filter(Boolean).length;

  return (
    <main className="access-shell">
      <section className="access-visual">
        <div className="access-brand">
          <img className="brand-logo" src={eltyarLogo} alt="" />
          <div>
            <strong>{t('app.name')}</strong>
            <small>{t('app.tagline')}</small>
          </div>
        </div>
        <div className="access-message">
          <span className="eyebrow">{t('common.localOnly')}</span>
          <h1>{mode === 'setup' ? t('access.setupHero') : t('access.loginHero')}</h1>
          <p>{t('access.heroDescription')}</p>
        </div>
        <div className="security-note">
          <Icon name="check" />
          {t('access.localSecurity')}
        </div>
      </section>
      <section className="access-form-panel">
        <button
          className="language-button access-language"
          type="button"
          onClick={() => void toggleLanguage()}
        >
          {t('header.switchLanguage')}
        </button>
        <form className="access-form" onSubmit={(event) => void submit(event)}>
          <span className="eyebrow">
            {mode === 'setup' ? t('access.firstRun') : t('access.welcomeBack')}
          </span>
          <h2>{mode === 'setup' ? t('access.createAdmin') : t('access.loginTitle')}</h2>
          <p>{mode === 'setup' ? t('access.setupDescription') : t('access.loginDescription')}</p>
          <label>
            <span>{t('access.username')}</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            <span>{t('access.password')}</span>
            <input
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
            />
          </label>
          {mode === 'setup' && (
            <>
              <div className="strength">
                <span className={passwordScore > 0 ? 'filled' : ''}></span>
                <span className={passwordScore > 1 ? 'filled' : ''}></span>
                <span className={passwordScore > 2 ? 'filled' : ''}></span>
                <small>{t('access.passwordHint')}</small>
              </div>
              <label>
                <span>{t('access.confirmPassword')}</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
              <div className="timezone-row">
                <span>{t('access.timezone')}</span>
                <strong>Africa/Cairo</strong>
              </div>
            </>
          )}
          {errorMessage && (
            <div className="form-error" role="alert">
              {errorMessage}
            </div>
          )}
          <button className="primary-action" type="submit" disabled={submitting}>
            {submitting
              ? t('access.working')
              : mode === 'setup'
                ? t('access.createAndContinue')
                : t('access.loginAction')}
          </button>
        </form>
      </section>
    </main>
  );
};

type AppView = 'loading' | 'bridge-error' | 'setup' | 'login' | 'dashboard';

export const App = (): React.JSX.Element => {
  const { t } = useTranslation();
  const [view, setView] = useState<AppView>('loading');
  const [session, setSession] = useState<SessionDto | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      if (!window.dawam) {
        if (window.location.search === '?ui-preview') {
          setSession({
            id: 1,
            username: 'preview-admin',
            role: 'admin',
            canImport: true,
            active: true,
            hasPhoto: false,
          });
          setView('dashboard');
        } else setView('bridge-error');
        return;
      }
      const bootstrap = await window.dawam.app.bootstrapState();
      if (!bootstrap.ok) {
        setView('login');
        return;
      }
      if (bootstrap.value.needsSetup) {
        setView('setup');
        return;
      }
      const current = await window.dawam.auth.currentSession();
      if (current.ok && current.value) {
        setSession(current.value);
        setView('dashboard');
      } else setView('login');
    };
    void load();
  }, []);

  const authenticated = (nextSession: SessionDto): void => {
    setSession(nextSession);
    setView('dashboard');
  };

  const logout = async (): Promise<void> => {
    if (window.dawam) await window.dawam.auth.logout();
    setSession(null);
    setView('login');
  };

  if (view === 'loading') return <div className="app-loading">{t('access.loading')}</div>;
  if (view === 'bridge-error') {
    return <div className="app-loading bridge-error">{t('errors.desktop_api_unavailable')}</div>;
  }
  if (view === 'setup' || view === 'login') {
    return <AccessScreen mode={view} onAuthenticated={authenticated} />;
  }
  return <Dashboard session={session!} onLogout={logout} />;
};
