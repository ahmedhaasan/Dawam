import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  EmployeeDto,
  ImportCommitSummaryDto,
  ImportPreviewDto,
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

export const ImportWizard = (): React.JSX.Element => {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<SelectedImportFile | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [summary, setSummary] = useState<ImportCommitSummaryDto | null>(null);
  const [coverageFrom, setCoverageFrom] = useState('');
  const [coverageTo, setCoverageTo] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quarantined, setQuarantined] = useState<readonly QuarantinedPunchDto[]>([]);
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [matches, setMatches] = useState<Record<number, string>>({});
  const [resolveReason, setResolveReason] = useState('');

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
        close();
        if (result.value.rowsQuarantined > 0) await loadQuarantine();
      }
    } catch {
      setError(t('errors.unexpected'));
    } finally {
      setBusy(false);
    }
  };

  const resolvePunch = async (quarantineId: number): Promise<void> => {
    const employeeId = Number(matches[quarantineId]);
    if (!window.dawam || !employeeId || !resolveReason.trim()) return;
    setBusy(true);
    const result = await window.dawam.imports.resolveQuarantined({
      quarantineId,
      employeeId,
      reason: resolveReason.trim(),
    });
    setBusy(false);
    if (!result.ok) setError(t(result.error.messageKey));
    else await loadQuarantine();
  };

  return (
    <>
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
      <small>{t('home.importHint')}</small>
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
              })}
            </span>
          </div>
          {quarantined.length > 0 && (
            <div className="quarantine-panel">
              <strong>{t('import.matchUnknown')}</strong>
              <input
                value={resolveReason}
                onChange={(event) => setResolveReason(event.target.value)}
                placeholder={t('import.matchReason')}
              />
              {quarantined.map((punch) => (
                <div className="quarantine-row" key={punch.id}>
                  <span>
                    <code>{punch.deviceUserId}</code> {punch.punchedAtLocal}
                  </span>
                  <select
                    value={matches[punch.id] ?? ''}
                    onChange={(event) =>
                      setMatches((current) => ({ ...current, [punch.id]: event.target.value }))
                    }
                  >
                    <option value="">{t('import.chooseEmployee')}</option>
                    {employees.map((employee) => (
                      <option value={employee.id} key={employee.id}>
                        {employee.fullName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !matches[punch.id] || !resolveReason.trim()}
                    onClick={() => void resolvePunch(punch.id)}
                  >
                    {t('import.match')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {preview && file && (
        <div className="import-overlay" role="dialog" aria-modal="true">
          <section className="import-dialog card">
            <div className="import-dialog-heading">
              <div>
                <span className="eyebrow">USB</span>
                <h2>{t('import.previewTitle')}</h2>
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
                <strong>{preview.rowsMalformed}</strong>
                <span>{t('import.malformed')}</span>
              </div>
            </div>
            <div className="import-sample table-card">
              <table>
                <thead>
                  <tr>
                    <th>{t('employees.deviceId')}</th>
                    <th>{t('import.punchTime')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.slice(0, 5).map((punch) => (
                    <tr key={`${punch.lineNo}-${punch.deviceUserId}`}>
                      <td>
                        <code>{punch.deviceUserId}</code>
                      </td>
                      <td>{punch.punchedAtLocal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.malformed.length > 0 && (
              <details className="malformed-details">
                <summary>{t('import.malformedDetails')}</summary>
                {preview.malformed.slice(0, 8).map((row) => (
                  <div key={`${row.lineNo}-${row.reason}`}>
                    {t('import.line')} {row.lineNo}: {row.reason}
                  </div>
                ))}
              </details>
            )}
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
      )}
    </>
  );
};
