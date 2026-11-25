import { type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type {
  EmployeeDto,
  ImportCommitSummaryDto,
  ImportPreviewDto,
  ImportReportDto,
  QuarantinedPunchDto,
} from '../../shared/ipc';

interface SelectedImportFile {
  filename: string;
  dataBase64: string;
}

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });

// Dialogs render at document level so the home card's stacking context and colours never leak in.
const WizardPortal = ({ children }: { children: ReactNode }): React.JSX.Element =>
  createPortal(<div className="import-wizard">{children}</div>, document.body);

const ImportReportView = ({
  report,
  committed,
}: {
  report: ImportReportDto;
  committed: boolean;
}): React.JSX.Element => {
  const { t } = useTranslation();
  const range =
    report.minLocal && report.maxLocal
      ? `${report.minLocal.slice(0, 10)} → ${report.maxLocal.slice(0, 10)}`
      : t('import.report.noRange');
  const cards: { key: string; value: React.ReactNode; label: string; tone?: string }[] = [
    { key: 'valid', value: report.rowsValid, label: t('import.report.validRows'), tone: 'good' },
    {
      key: 'bad',
      value: report.rowsMalformed,
      label: t('import.report.badRows'),
      ...(report.rowsMalformed > 0 ? { tone: 'bad' } : {}),
    },
    {
      key: 'unknown',
      value: report.unknownDeviceIds.length,
      label: t('import.report.unknownIds'),
      ...(report.unknownDeviceIds.length > 0 ? { tone: 'warn' } : {}),
    },
    {
      key: 'exact',
      value: report.exactDuplicates,
      label: t('import.report.exactDuplicates'),
    },
    { key: 'repeat', value: report.repeatedScans, label: t('import.report.repeatedScans') },
    {
      key: 'replace',
      value: report.punchesToReplace,
      label: committed ? t('import.report.replaced') : t('import.report.toReplace'),
      ...(report.punchesToReplace > 0 ? { tone: 'warn' } : {}),
    },
  ];
  return (
    <section className="import-report" aria-label={t('import.report.title')}>
      <h3>{t('import.report.title')}</h3>
      <div className="import-report-range">
        <span>{t('import.report.dateRange')}</span>
        <strong dir="ltr">{range}</strong>
        <small>
          {t('import.report.daysCount', {
            count: report.daysCovered,
            withPunches: report.daysWithPunches,
          })}
        </small>
      </div>
      <div className="import-report-cards">
        {cards.map((card) => (
          <div className={`import-report-card ${card.tone ?? ''}`} key={card.key}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </div>
        ))}
      </div>
      <p className="import-report-note">{t('import.report.repeatHelp')}</p>
      {report.punchesToReplace > 0 && (
        <p className="import-report-note warn">{t('import.report.replaceHelp')}</p>
      )}
      <p className="import-report-note">
        {report.unknownDeviceIds.length > 0 ? (
          <>
            {t('import.report.unknownHelp')}{' '}
            {report.unknownDeviceIds.map((item) => (
              <span className="import-report-chip" key={item.deviceUserId}>
                <code>{item.deviceUserId}</code> ·{' '}
                {t('import.punchCount', { count: item.punchCount })}
              </span>
            ))}
          </>
        ) : (
          t('import.report.noUnknown')
        )}
      </p>
      {report.rowsMalformed > 0 && (
        <details className="import-report-bad">
          <summary>
            {t('import.report.badRowsDetails', {
              shown: report.malformed.length,
              count: report.rowsMalformed,
            })}
          </summary>
          <ul>
            {report.malformed.map((row) => (
              <li key={`${row.lineNo}-${row.reason}`}>
                <strong>
                  {t('import.line')} {row.lineNo}
                </strong>
                <span>{t(`import.report.reason${row.reason}`)}</span>
                <code dir="ltr">{row.rawLine.trim() || '∅'}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      <h4>{t('import.report.perEmployee')}</h4>
      <div className="import-report-table">
        <table>
          <thead>
            <tr>
              <th>{t('import.report.deviceId')}</th>
              <th>{t('import.report.employee')}</th>
              <th>{t('import.report.status')}</th>
              <th>{t('import.report.punches')}</th>
              <th>{t('import.report.days')}</th>
              <th>{t('import.report.first')}</th>
              <th>{t('import.report.last')}</th>
              <th>{t('import.report.duplicates')}</th>
              <th>{t('import.report.replaceColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {report.byDeviceId.map((row) => (
              <tr key={row.deviceUserId}>
                <td>
                  <code>{row.deviceUserId}</code>
                </td>
                <td>{row.employeeName ?? '—'}</td>
                <td>
                  <span className={`import-report-status ${row.status.toLowerCase()}`}>
                    {t(`import.report.status${row.status}`)}
                  </span>
                </td>
                <td>{row.punchCount}</td>
                <td>{row.daysWithPunches}</td>
                <td dir="ltr">{row.firstLocal}</td>
                <td dir="ltr">{row.lastLocal}</td>
                <td>
                  {row.exactDuplicates} / {row.repeatedScans}
                </td>
                <td>{row.punchesToReplace}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export const ImportWizard = (): React.JSX.Element => {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<SelectedImportFile | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [summary, setSummary] = useState<ImportCommitSummaryDto | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [coverageFrom, setCoverageFrom] = useState('');
  const [coverageTo, setCoverageTo] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quarantined, setQuarantined] = useState<readonly QuarantinedPunchDto[]>([]);
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [resolveReason, setResolveReason] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<readonly string[]>([]);

  const unknownGroups = useMemo(() => {
    const groups = new Map<string, QuarantinedPunchDto[]>();
    for (const punch of quarantined) {
      const rows = groups.get(punch.deviceUserId) ?? [];
      rows.push(punch);
      groups.set(punch.deviceUserId, rows);
    }
    return [...groups.entries()]
      .filter(([deviceId]) => !dismissedIds.includes(deviceId))
      .map(([deviceId, rows]) => ({
        deviceId,
        rows: rows.sort((a, b) => a.punchedAtLocal.localeCompare(b.punchedAtLocal)),
        count: rows.length,
        first: rows[0]!.punchedAtLocal.slice(0, 10),
        last: rows[rows.length - 1]!.punchedAtLocal.slice(0, 10),
      }));
  }, [dismissedIds, quarantined]);

  const loadQuarantine = async (): Promise<void> => {
    if (!window.dawam) return;
    const [punches, people] = await Promise.all([
      window.dawam.imports.listQuarantined(),
      window.dawam.workforce.listEmployees(),
    ]);
    if (punches.ok) setQuarantined(punches.value);
    if (people.ok) setEmployees(people.value.filter((employee) => employee.active));
  };

  const close = (): void => {
    setFile(null);
    setPreview(null);
    setError('');
    setConfirmed(false);
  };

  const choose = async (selected: File): Promise<void> => {
    setBusy(true);
    setSummary(null);
    setError('');
    try {
      if (!window.dawam) throw new Error('Desktop API unavailable');
      if (selected.size > 10 * 1024 * 1024) {
        setError(t('errors.import_file_too_large'));
        return;
      }
      const selectedFile = { filename: selected.name, dataBase64: await readBase64(selected) };
      const result = await window.dawam.imports.preview(selectedFile);
      if (!result.ok) {
        setError(t(result.error.messageKey));
        return;
      }
      setFile(selectedFile);
      setPreview(result.value);
      setCoverageFrom(result.value.minLocal?.slice(0, 10) ?? '');
      setCoverageTo(result.value.maxLocal?.slice(0, 10) ?? '');
    } catch {
      setError(t('errors.unexpected'));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  };

  const commit = async (): Promise<void> => {
    if (!window.dawam || !file || !coverageFrom || !coverageTo || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.dawam.imports.commit({
        ...file,
        coverageFrom: `${coverageFrom} 00:00:00`,
        coverageTo: `${coverageTo} 23:59:59`,
        coverageConfirmed: true,
      });
      if (!result.ok) setError(t(result.error.messageKey));
      else {
        setSummary(result.value);
        setResultOpen(true);
        close();
        if (result.value.rowsQuarantined > 0) await loadQuarantine();
      }
    } catch {
      setError(t('errors.unexpected'));
    } finally {
      setBusy(false);
    }
  };

  const resolveDeviceId = async (
    deviceId: string,
    rows: readonly QuarantinedPunchDto[],
  ): Promise<void> => {
    const employeeId = Number(matches[deviceId]);
    if (!window.dawam || !employeeId || !resolveReason.trim()) return;
    setBusy(true);
    let failed = false;
    for (const row of rows) {
      const result = await window.dawam.imports.resolveQuarantined({
        quarantineId: row.id,
        employeeId,
        reason: resolveReason.trim(),
      });
      if (!result.ok) {
        setError(t(result.error.messageKey));
        failed = true;
        break;
      }
    }
    setBusy(false);
    if (!failed) await loadQuarantine();
  };

  const ignoreDeviceId = async (quarantineId: number): Promise<void> => {
    if (!window.dawam || !resolveReason.trim()) return;
    if (!window.confirm(t('import.ignoreConfirm'))) return;
    setBusy(true);
    const result = await window.dawam.imports.ignoreDeviceId({
      quarantineId,
      reason: resolveReason.trim(),
    });
    setBusy(false);
    if (!result.ok) setError(t(result.error.messageKey));
    else await loadQuarantine();
  };

  return (
    <div className="import-wizard">
      <input
        ref={picker}
        className="file-picker-hidden"
        type="file"
        accept=".dat,.txt,.csv,.json,.xls"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void choose(selected);
        }}
      />
      <button type="button" disabled={busy} onClick={() => picker.current?.click()}>
        <span aria-hidden="true">↑</span>
        {busy ? t('import.working') : t('home.importAction')}
      </button>
      {error && !preview && (
        <div className="import-inline-error" role="alert">
          {error}
        </div>
      )}
      {summary && (
        <>
          <div className="import-success" role="status">
            <strong>{t('import.completed')}</strong>
            <span>
              {t('import.summaryLine', {
                newCount: summary.rowsNew,
                duplicateCount: summary.rowsDuplicate,
                quarantineCount: summary.rowsQuarantined,
                ignoredCount: summary.rowsIgnored,
              })}
            </span>
            <span>{t('import.appliedNotice')}</span>
          </div>
          {resultOpen && (
            <WizardPortal>
              <div
                className="import-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="import-result-title"
              >
                <section className="import-dialog card">
                  <div className="import-dialog-heading">
                    <div>
                      <h2 id="import-result-title">{t('import.resultTitle')}</h2>
                    </div>
                    <button
                      className="dialog-close"
                      type="button"
                      onClick={() => setResultOpen(false)}
                    >
                      {t('common.close')}
                    </button>
                  </div>
                  <div className="import-applied" role="status">
                    <strong>{t('import.completed')}</strong>
                    <span>{t('import.appliedNotice')}</span>
                  </div>
                  <div className="import-counts">
                    <div>
                      <strong>{summary.rowsNew}</strong>
                      <span>{t('import.newRows')}</span>
                    </div>
                    <div>
                      <strong>{summary.rowsDuplicate}</strong>
                      <span>{t('import.duplicates')}</span>
                    </div>
                    <div>
                      <strong>{summary.rowsQuarantined}</strong>
                      <span>{t('import.quarantined')}</span>
                    </div>
                    <div>
                      <strong>{summary.rowsIgnored}</strong>
                      <span>{t('import.ignored')}</span>
                    </div>
                    <div>
                      <strong>{summary.rowsReplaced}</strong>
                      <span>{t('import.report.replaced')}</span>
                    </div>
                  </div>
                  <ImportReportView report={summary.report} committed />
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => setResultOpen(false)}
                  >
                    {t('common.close')}
                  </button>
                </section>
              </div>
            </WizardPortal>
          )}
          {!resultOpen && unknownGroups.length > 0 && (
            <WizardPortal>
              <div
                className="unknown-id-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="unknown-id-title"
              >
                <section className="unknown-id-dialog card">
                  <div className="import-dialog-heading">
                    <div>
                      <h2 id="unknown-id-title">{t('import.matchUnknown')}</h2>
                      <p>{t('import.unknownGroupedHelp')}</p>
                    </div>
                    <button
                      className="dialog-close"
                      type="button"
                      onClick={() => setDismissedIds(unknownGroups.map((group) => group.deviceId))}
                    >
                      {t('common.close')}
                    </button>
                  </div>
                  <label className="unknown-reason">
                    <span>{t('import.matchReason')}</span>
                    <input
                      value={resolveReason}
                      onChange={(event) => setResolveReason(event.target.value)}
                    />
                  </label>
                  <div className="unknown-groups">
                    {unknownGroups.map((group) => {
                      const query = employeeSearch[group.deviceId] ?? '';
                      const filteredEmployees = employees.filter(
                        (employee) =>
                          employee.fullName
                            .toLocaleLowerCase()
                            .includes(query.toLocaleLowerCase()) ||
                          employee.deviceUserId.includes(query),
                      );
                      return (
                        <article className="unknown-group" key={group.deviceId}>
                          <div className="unknown-group-stats">
                            <strong>
                              <code>{group.deviceId}</code>
                            </strong>
                            <span>{t('import.punchCount', { count: group.count })}</span>
                            <span>
                              {t('import.dateRange', { first: group.first, last: group.last })}
                            </span>
                          </div>
                          <input
                            aria-label={t('import.searchEmployee')}
                            placeholder={t('import.searchEmployee')}
                            value={query}
                            onChange={(event) =>
                              setEmployeeSearch((current) => ({
                                ...current,
                                [group.deviceId]: event.target.value,
                              }))
                            }
                          />
                          <select
                            aria-label={t('import.chooseEmployee')}
                            value={matches[group.deviceId] ?? ''}
                            onChange={(event) =>
                              setMatches((current) => ({
                                ...current,
                                [group.deviceId]: event.target.value,
                              }))
                            }
                          >
                            <option value="">{t('import.chooseEmployee')}</option>
                            {filteredEmployees.map((employee) => (
                              <option value={employee.id} key={employee.id}>
                                {employee.fullName} · {employee.deviceUserId}
                              </option>
                            ))}
                          </select>
                          <div className="unknown-actions">
                            <button
                              type="button"
                              disabled={busy || !matches[group.deviceId] || !resolveReason.trim()}
                              onClick={() => void resolveDeviceId(group.deviceId, group.rows)}
                            >
                              {t('import.match')}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDismissedIds((current) => [...current, group.deviceId])
                              }
                            >
                              {t('import.ignoreForNow')}
                            </button>
                            <button
                              className="ignore-device-button"
                              type="button"
                              disabled={busy || !resolveReason.trim()}
                              onClick={() => void ignoreDeviceId(group.rows[0]!.id)}
                            >
                              {t('import.ignoreDevice')}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </div>
            </WizardPortal>
          )}
        </>
      )}
      {preview && file && (
        <WizardPortal>
          <div
            className="import-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-preview-title"
          >
            <section className="import-dialog card">
              <div className="import-dialog-heading">
                <div>
                  <span className="eyebrow">USB</span>
                  <h2 id="import-preview-title">{t('import.previewTitle')}</h2>
                  <p>{preview.filename}</p>
                </div>
                <button className="dialog-close" type="button" onClick={close}>
                  {t('common.close')}
                </button>
              </div>
              <div className="import-badges">
                <span>{preview.format}</span>
                <span
                  className={
                    preview.verification === 'VERIFIED_REAL_FIXTURE' ? 'verified' : 'unverified'
                  }
                >
                  {preview.verification === 'VERIFIED_REAL_FIXTURE'
                    ? t('import.verified')
                    : t('import.unverified')}
                </span>
              </div>
              <div className="import-counts">
                <div>
                  <strong>{preview.predictedNew}</strong>
                  <span>{t('import.newRows')}</span>
                </div>
                <div>
                  <strong>{preview.predictedDuplicate}</strong>
                  <span>{t('import.duplicates')}</span>
                </div>
                <div>
                  <strong>{preview.predictedQuarantined}</strong>
                  <span>{t('import.quarantined')}</span>
                </div>
                <div>
                  <strong>{preview.predictedIgnored}</strong>
                  <span>{t('import.ignored')}</span>
                </div>
              </div>
              <ImportReportView report={preview.report} committed={false} />
              <div className="coverage-fields">
                <label>
                  <span>{t('import.coverageFrom')}</span>
                  <input
                    type="date"
                    value={coverageFrom}
                    onChange={(event) => setCoverageFrom(event.target.value)}
                  />
                </label>
                <label>
                  <span>{t('import.coverageTo')}</span>
                  <input
                    type="date"
                    value={coverageTo}
                    onChange={(event) => setCoverageTo(event.target.value)}
                  />
                </label>
              </div>
              <label className="coverage-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>{t('import.coverageConfirm')}</span>
              </label>
              <p className="coverage-warning">{t('import.coverageWarning')}</p>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="primary-action"
                type="button"
                disabled={busy || !confirmed || !coverageFrom || !coverageTo}
                onClick={() => void commit()}
              >
                {busy ? t('import.working') : t('import.commit')}
              </button>
            </section>
          </div>
        </WizardPortal>
      )}
    </div>
  );
};
