import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'danger';
  size?: 'md' | 'lg';
  onSubmit: (event: React.FormEvent) => void;
}

/** Modal form dialog: fits the viewport and scrolls its body internally. */
export const WfDialog = ({
  title,
  subtitle,
  onClose,
  footer,
  children,
  tone = 'default',
  size = 'lg',
  onSubmit,
}: Props): React.JSX.Element => {
  const { t } = useTranslation();
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="wf-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form className={`wf-dialog ${size} ${tone}`} onSubmit={onSubmit} noValidate>
        <header className="wf-dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="wf-icon-button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </header>
        <div className="wf-dialog-body">{children}</div>
        <footer className="wf-dialog-foot">{footer}</footer>
      </form>
    </div>,
    document.body,
  );
};

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: React.ReactNode;
  wide?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

export const WfField = ({
  label,
  htmlFor,
  error,
  hint,
  wide = false,
  badge,
  children,
}: FieldProps): React.JSX.Element => (
  <div className={`wf-field${wide ? ' wide' : ''}${error ? ' invalid' : ''}`}>
    <label htmlFor={htmlFor}>
      <span>{label}</span>
      {badge}
    </label>
    {children}
    {error ? (
      <small className="wf-field-error" id={`${htmlFor}-error`} role="alert">
        {error}
      </small>
    ) : (
      hint && <small className="wf-field-hint">{hint}</small>
    )}
  </div>
);
