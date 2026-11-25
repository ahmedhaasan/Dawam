import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_LATE_METHODS,
  DEFAULT_OVERTIME_METHODS,
  egpToMinor,
  explainLate,
  explainOvertime,
  type LateMethod,
  type OvertimeMethod,
  type OvertimeRounding,
  type RuleDraft,
} from './payroll-rules';

interface PayrollRulesDialogProps {
  initial: RuleDraft;
  dailyWageMinor: number;
  money: (minor: number) => string;
  editedDayCount: number;
  followingDayCount: number;
  onCancel: () => void;
  onSave: (draft: RuleDraft) => void;
  onResetEditedDays: () => void;
}

export const PayrollRulesDialog = ({
  initial,
  dailyWageMinor,
  money,
  editedDayCount,
  followingDayCount,
  onCancel,
  onSave,
  onResetEditedDays,
}: PayrollRulesDialogProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const firstField = useRef<HTMLInputElement>(null);
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const perMinute = money(egpToMinor(draft.lateHourPrice) / 60);

  return (
    <div className="pb-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        className="pb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pb-rules-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pb-dialog-head">
          <div>
            <span className="pb-eyebrow">{t('payroll.monthRules')}</span>
            <h2 id="pb-rules-title">{t('payroll.board.dialogTitle')}</h2>
            <p>{t('payroll.board.dialogIntro')}</p>
          </div>
          <button
            type="button"
            className="pb-icon-button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onCancel}
          >
            ✕
          </button>
        </header>

        <div className="pb-dialog-body">
          <section className="pb-step">
            <h3>{t('payroll.board.step1')}</h3>
            <div className="pb-pair">
              <fieldset className="pb-panel pb-panel--late">
                <legend>{t('payroll.board.latePrices')}</legend>
                <PriceField
                  inputRef={firstField}
                  label={t('payroll.board.lateHourPrice')}
                  value={draft.lateHourPrice}
                  onChange={(value) => set('lateHourPrice', value)}
                  step="0.01"
                />
                <label className="pb-field pb-field--readonly">
                  <span>{t('payroll.board.lateMinutePrice')}</span>
                  <output>{perMinute}</output>
                </label>
                <PriceField
                  label={t('payroll.board.graceMinutes')}
                  help={t('payroll.board.graceHelp')}
                  value={draft.grace}
                  onChange={(value) => set('grace', value)}
                />
                <PriceField
                  label={t('payroll.board.hourThreshold')}
                  value={draft.hourThreshold}
                  onChange={(value) => set('hourThreshold', value)}
                />
                <PriceField
                  label={t('payroll.board.shortAmount')}
                  value={draft.shortAmount}
                  onChange={(value) => set('shortAmount', value)}
                  step="0.01"
                />
                <PriceField
                  label={t('payroll.board.fullDayThreshold')}
                  value={draft.fullDayThreshold}
                  onChange={(value) => set('fullDayThreshold', value)}
                />
                <label className="pb-field pb-field--readonly">
                  <span>{t('payroll.board.dailyWageReadOnly')}</span>
                  <output>{money(dailyWageMinor)}</output>
                </label>
              </fieldset>
              <fieldset className="pb-panel pb-panel--overtime">
                <legend>{t('payroll.board.overtimePrices')}</legend>
                <PriceField
                  label={t('payroll.board.overtimeHourPrice')}
                  value={draft.overtimeHourPrice}
                  onChange={(value) => set('overtimeHourPrice', value)}
                  step="0.01"
                />
                <PriceField
                  label={t('payroll.board.overtimeMinimum')}
                  value={draft.overtimeMinimum}
                  onChange={(value) => set('overtimeMinimum', value)}
                />
                <label className="pb-field">
                  <span>{t('payroll.board.overtimeRounding')}</span>
                  <select
                    value={draft.overtimeRounding}
                    onChange={(event) =>
                      set('overtimeRounding', event.target.value as OvertimeRounding)
                    }
                  >
                    <option value="exact">{t('payroll.roundingExact')}</option>
                    <option value="down_30">{t('payroll.rounding30')}</option>
                    <option value="down_60">{t('payroll.rounding60')}</option>
                  </select>
                </label>
                <PriceField
                  label={t('payroll.board.extraDayHours')}
                  value={draft.extraDayHours}
                  onChange={(value) => set('extraDayHours', value)}
                  min="1"
                />
              </fieldset>
            </div>
          </section>

          <div className="pb-pair">
            <section className="pb-step">
              <h3>{t('payroll.board.step2')}</h3>
              <div className="pb-methods" role="radiogroup" aria-label={t('payroll.board.step2')}>
                {DEFAULT_LATE_METHODS.map((method) => (
                  <MethodCard
                    key={method}
                    name="pb-late-method"
                    checked={draft.lateMethod === method}
                    title={t(`payroll.lateMethods.${method}`)}
                    detail={explainLate(t, method, draft, money, dailyWageMinor)}
                    onSelect={() => set('lateMethod', method as LateMethod)}
                  />
                ))}
              </div>
            </section>
            <section className="pb-step">
              <h3>{t('payroll.board.step3')}</h3>
              <div className="pb-methods" role="radiogroup" aria-label={t('payroll.board.step3')}>
                {DEFAULT_OVERTIME_METHODS.map((method) => (
                  <MethodCard
                    key={method}
                    name="pb-overtime-method"
                    checked={draft.overtimeMethod === method}
                    title={t(`payroll.overtimeMethods.${method}`)}
                    detail={explainOvertime(t, method, draft, money, dailyWageMinor)}
                    onSelect={() => set('overtimeMethod', method as OvertimeMethod)}
                  />
                ))}
              </div>
            </section>
          </div>
          <p className="pb-note">{t('payroll.board.customNote')}</p>
        </div>

        <footer className="pb-dialog-foot">
          <div className="pb-foot-counts">
            <span>{t('payroll.followingCount', { count: followingDayCount })}</span>
            <span>{t('payroll.editedCount', { count: editedDayCount })}</span>
          </div>
          <div className="pb-foot-actions">
            <button
              type="button"
              className="pb-button pb-button--ghost"
              disabled={editedDayCount === 0}
              onClick={onResetEditedDays}
            >
              {t('payroll.resetEditedDays')}
            </button>
            <button type="button" className="pb-button pb-button--ghost" onClick={onCancel}>
              {t('payroll.cancelRules')}
            </button>
            <button type="button" className="pb-button" onClick={() => onSave(draft)}>
              {t('payroll.saveRules')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

const PriceField = ({
  label,
  help,
  value,
  onChange,
  step = '1',
  min = '0',
  inputRef,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}): React.JSX.Element => (
  <label className="pb-field">
    <span>
      {label}
      {help && <small>{help}</small>}
    </span>
    <input
      ref={inputRef}
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
);

const MethodCard = ({
  name,
  checked,
  title,
  detail,
  onSelect,
}: {
  name: string;
  checked: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}): React.JSX.Element => (
  <label className={`pb-method${checked ? ' is-selected' : ''}`}>
    <input type="radio" name={name} checked={checked} onChange={onSelect} />
    <span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </span>
  </label>
);
