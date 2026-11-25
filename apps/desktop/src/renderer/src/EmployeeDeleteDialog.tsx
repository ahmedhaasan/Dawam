import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EmployeeDto, EmployeePurgeCountsDto } from '../../shared/ipc';
import { WfDialog, WfField } from './WfDialog';
import { errorText } from './workforceShared';

interface Props {
  employee: EmployeeDto;
  onClose: () => void;
  onDeleted: (message: string) => void;
}

const COUNT_KEYS: readonly (keyof EmployeePurgeCountsDto)[] = [
  'punches',
  'quarantined',
  'corrections',
  'assignments',
  'weeklyRest',
  'overrides',
  'pairs',
  'leaves',
  'payrollRuns',
  'ignoredDeviceIds',
];

/** Permanent purge: lists what will be removed and requires the typed device user ID. */
export const EmployeeDeleteDialog = ({
  employee,
  onClose,
  onDeleted,
}: Props): React.JSX.Element => {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<EmployeePurgeCountsDto | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!window.dawam) {
      setCounts({
        punches: 0,
        quarantined: 0,
        assignments: 0,
        weeklyRest: 0,
        overrides: 0,
        pairs: 0,
        leaves: 0,
        corrections: 0,
        payrollRuns: 0,
        ignoredDeviceIds: 0,
      });
      return;
    }
    void window.dawam.workforce.employeePurgePreview({ employeeId: employee.id }).then((result) => {
      if (result.ok) setCounts(result.value);
      else setMessage(errorText(result.error, t));
    });
  }, [employee.id, t]);

  const matches = confirmation === employee.deviceUserId;
  const reasonError = submitted && !reason.trim() ? t('wf.common.reasonRequired') : undefined;
  const confirmError =
    (submitted || confirmation.length >= employee.deviceUserId.length) && confirmation && !matches
      ? t('wf.delete.mismatch')
      : submitted && !confirmation
        ? t('wf.delete.typeRequired')
        : undefined;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);
    setMessage('');
    if (!matches || !reason.trim()) return;
    if (!window.dawam) {
      onDeleted(t('employees.deleted'));
      return;
    }
    setDeleting(true);
    const result = await window.dawam.workforce.deleteEmployee({
      employeeId: employee.id,
      reason: reason.trim(),
      confirmation,
    });
    setDeleting(false);
    if (!result.ok) {
      setMessage(errorText(result.error, t));
      return;
    }
    onDeleted(t('wf.delete.done', { name: employee.fullName }));
  };

  return (
    <WfDialog
      title={t('wf.delete.title', { name: employee.fullName })}
      subtitle={t('wf.delete.subtitle')}
      tone="danger"
      size="md"
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <button type="button" className="wf-button ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="wf-button danger"
            disabled={deleting || !matches || !counts}
          >
            {deleting ? t('wf.delete.deleting') : t('wf.delete.confirm')}
          </button>
        </>
      }
    >
      {message && (
        <div className="wf-alert danger" role="alert">
          {message}
        </div>
      )}
      {employee.active && <div className="wf-alert warning">{t('wf.delete.activeNote')}</div>}
      <section className="wf-purge-summary" aria-live="polite">
        <h3>{t('wf.delete.willRemove')}</h3>
        {counts ? (
          <ul>
            <li>
              <span>{t('wf.delete.counts.profile')}</span>
              <b>1</b>
            </li>
            {COUNT_KEYS.map((key) => (
              <li key={key} className={counts[key] > 0 ? 'has' : ''}>
                <span>{t(`wf.delete.counts.${key}`)}</span>
                <b>{counts[key]}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wf-muted">{t('common.loading')}</p>
        )}
        <p className="wf-muted">{t('wf.delete.kept')}</p>
      </section>
      <div className="wf-group-grid">
        <WfField label={t('common.reason')} htmlFor="purge-reason" error={reasonError} wide>
          <input
            id="purge-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </WfField>
        <WfField
          label={t('wf.delete.typeLabel', { deviceId: employee.deviceUserId })}
          htmlFor="purge-confirm"
          error={confirmError}
          hint={t('wf.delete.typeHint')}
          wide
        >
          <input
            id="purge-confirm"
            dir="ltr"
            autoComplete="off"
            autoFocus
            value={confirmation}
            aria-invalid={Boolean(confirmError)}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </WfField>
      </div>
    </WfDialog>
  );
};
