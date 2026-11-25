import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EmployeeDto, EmployeeScheduleDto, ShiftTemplateDto } from '../../shared/ipc';
import { WfDialog, WfField } from './WfDialog';
import { errorText, initials, minuteLabel } from './workforceShared';

type PhotoInput = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; dataBase64: string };

interface FormState {
  fullName: string;
  deviceUserId: string;
  hireDate: string;
  active: boolean;
  salary: string;
  wageBasisDays: string;
  templateId: string;
  weekday: string;
  partnerId: string;
  effectiveFrom: string;
  reason: string;
}

type FieldKey =
  | 'fullName'
  | 'deviceUserId'
  | 'hireDate'
  | 'salary'
  | 'wageBasisDays'
  | 'templateId'
  | 'partnerId'
  | 'effectiveFrom'
  | 'reason';

interface Props {
  employee: EmployeeDto | null;
  employees: readonly EmployeeDto[];
  templates: readonly ShiftTemplateDto[];
  currentPhotoUrl?: string | undefined;
  today: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const validate = (
  form: FormState,
  editing: boolean,
  employees: readonly EmployeeDto[],
  employeeId: number | null,
): Partial<Record<FieldKey, string>> => {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!form.fullName.trim()) errors.fullName = 'wf.employeeForm.errors.nameRequired';
  const deviceId = form.deviceUserId.trim();
  if (!deviceId) errors.deviceUserId = 'wf.employeeForm.errors.deviceRequired';
  else if (/\s/.test(form.deviceUserId))
    errors.deviceUserId = 'wf.employeeForm.errors.deviceSpaces';
  else if (employees.some((item) => item.deviceUserId === deviceId && item.id !== employeeId))
    errors.deviceUserId = 'wf.employeeForm.errors.deviceDuplicate';
  if (!editing && !DATE_RE.test(form.hireDate))
    errors.hireDate = 'wf.employeeForm.errors.hireDateRequired';
  if (form.salary.trim() && !/^\d+(\.\d{1,2})?$/.test(form.salary.trim()))
    errors.salary = 'wf.employeeForm.errors.salary';
  const basis = Number(form.wageBasisDays);
  if (!/^\d+$/.test(form.wageBasisDays) || basis < 1 || basis > 366)
    errors.wageBasisDays = 'wf.employeeForm.errors.wageBasis';
  if (!form.templateId) errors.templateId = 'wf.employeeForm.errors.templateRequired';
  if (editing && !DATE_RE.test(form.effectiveFrom))
    errors.effectiveFrom = 'wf.employeeForm.errors.effectiveFrom';
  if (editing && !form.reason.trim()) errors.reason = 'wf.common.reasonRequired';
  return errors;
};

export const EmployeeForm = ({
  employee,
  employees,
  templates,
  currentPhotoUrl,
  today,
  onClose,
  onSaved,
}: Props): React.JSX.Element => {
  const { t } = useTranslation();
  const editing = employee !== null;
  const [form, setForm] = useState<FormState>({
    fullName: employee?.fullName ?? '',
    deviceUserId: employee?.deviceUserId ?? '',
    hireDate: employee?.hireDate ?? (editing ? '' : today),
    active: employee?.active ?? true,
    salary: employee?.monthlySalaryMinor == null ? '' : String(employee.monthlySalaryMinor / 100),
    wageBasisDays: String(employee?.wageBasisDays ?? 30),
    templateId: String(templates.find((item) => item.active)?.id ?? templates[0]?.id ?? ''),
    weekday: '5',
    partnerId: '',
    effectiveFrom: today,
    reason: '',
  });
  const [photo, setPhoto] = useState<PhotoInput>();
  const [photoName, setPhotoName] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(editing);
  const [partnerSchedule, setPartnerSchedule] = useState<EmployeeScheduleDto | null>(null);

  useEffect(() => {
    if (!employee || !window.dawam) {
      setLoadingSchedule(false);
      return;
    }
    void window.dawam.workforce
      .getEmployeeSchedule({ employeeId: employee.id, date: today })
      .then((result) => {
        setLoadingSchedule(false);
        if (!result.ok) {
          setMessage(errorText(result.error, t));
          return;
        }
        setForm((current) => ({
          ...current,
          templateId:
            result.value.templateId == null ? current.templateId : String(result.value.templateId),
          weekday: result.value.weekday == null ? current.weekday : String(result.value.weekday),
          partnerId: result.value.partnerId == null ? '' : String(result.value.partnerId),
        }));
      });
  }, [employee, today, t]);

  useEffect(() => {
    setPartnerSchedule(null);
    if (!form.partnerId || !window.dawam) return;
    void window.dawam.workforce
      .getEmployeeSchedule({
        employeeId: Number(form.partnerId),
        date: form.effectiveFrom || today,
      })
      .then((result) => {
        if (result.ok) setPartnerSchedule(result.value);
      });
  }, [form.partnerId, form.effectiveFrom, today]);

  const clientErrors = validate(form, editing, employees, employee?.id ?? null);
  const errors = { ...clientErrors, ...serverErrors };
  const show = (key: FieldKey): string | undefined =>
    errors[key] && (submitted || touched[key] || serverErrors[key]) ? t(errors[key]) : undefined;
  const update = (patch: Partial<FormState>): void => {
    const keys = Object.keys(patch) as FieldKey[];
    setServerErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setForm((current) => ({ ...current, ...patch }));
  };
  const blur = (key: FieldKey) => () => setTouched((current) => ({ ...current, [key]: true }));
  const aria = (key: FieldKey) => ({
    'aria-invalid': Boolean(show(key)),
    'aria-describedby': show(key) ? `emp-${key}-error` : undefined,
  });

  const readPhoto = (file?: File): void => {
    setPhotoError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError(t('wf.employeeForm.errors.photoType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto({
        mimeType: file.type as PhotoInput['mimeType'],
        dataBase64: String(reader.result).split(',')[1] ?? '',
      });
      setPhotoName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);
    setMessage('');
    if (Object.keys(clientErrors).length > 0) return;
    if (!window.dawam) {
      onSaved(t('wf.employeeForm.saved'));
      return;
    }
    setSaving(true);
    const input = {
      fullName: form.fullName.trim(),
      deviceUserId: form.deviceUserId.trim(),
      active: form.active,
      ...(form.hireDate ? { hireDate: form.hireDate } : {}),
      ...(editing
        ? { monthlySalaryMinor: form.salary.trim() ? Math.round(Number(form.salary) * 100) : null }
        : form.salary.trim()
          ? { monthlySalaryMinor: Math.round(Number(form.salary) * 100) }
          : {}),
      wageBasisDays: Number(form.wageBasisDays),
      ...(photo ? { photo } : {}),
      reason: editing ? form.reason.trim() : 'Initial employee record',
    };
    const result = employee
      ? await window.dawam.workforce.updateEmployee({ id: employee.id, ...input })
      : await window.dawam.workforce.createEmployee(input);
    if (!result.ok) {
      setSaving(false);
      if (result.error.code === 'DUPLICATE_DEVICE_USER_ID')
        setServerErrors({ deviceUserId: 'wf.employeeForm.errors.deviceDuplicate' });
      else setMessage(errorText(result.error, t));
      return;
    }
    const schedule = await window.dawam.workforce.updateEmployeeSchedule({
      employeeId: result.value.id,
      templateId: Number(form.templateId),
      weekday: Number(form.weekday),
      partnerId: form.partnerId ? Number(form.partnerId) : null,
      effectiveFrom: editing ? form.effectiveFrom : form.hireDate,
      reason: editing ? form.reason.trim() : 'Initial employee schedule',
    });
    setSaving(false);
    if (!schedule.ok) {
      if (schedule.error.code === 'PAIR_CONFLICT' || schedule.error.code === 'PAIR_SAME_EMPLOYEE')
        setServerErrors({ partnerId: schedule.error.messageKey });
      setMessage(t('wf.employeeForm.scheduleFailed', { error: errorText(schedule.error, t) }));
      return;
    }
    onSaved(t('wf.employeeForm.saved'));
  };

  const selectedTemplate = templates.find((item) => String(item.id) === form.templateId);
  const partner = employees.find((item) => String(item.id) === form.partnerId);
  const partnerTemplate = templates.find((item) => item.id === partnerSchedule?.templateId);
  const coverage =
    selectedTemplate && partnerTemplate
      ? {
          start: Math.min(selectedTemplate.startMin, partnerTemplate.startMin),
          end: Math.max(selectedTemplate.endMin, partnerTemplate.endMin),
        }
      : null;
  const sameRest =
    partnerSchedule?.weekday != null && String(partnerSchedule.weekday) === form.weekday;
  const previewUrl = photo ? `data:${photo.mimeType};base64,${photo.dataBase64}` : currentPhotoUrl;
  const deviceHint =
    form.deviceUserId.trim() && !/^\d+$/.test(form.deviceUserId.trim())
      ? t('wf.employeeForm.deviceNonDigitHint')
      : t('wf.employeeForm.deviceHint');

  return (
    <WfDialog
      title={
        employee
          ? t('wf.employeeForm.editTitle', { name: employee.fullName })
          : t('wf.employeeForm.addTitle')
      }
      subtitle={t('wf.employeeForm.subtitle')}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <button type="button" className="wf-button ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="wf-button primary" disabled={saving || loadingSchedule}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      {message && (
        <div className="wf-alert danger" role="alert">
          {message}
        </div>
      )}
      <div className="wf-form-grid">
        <fieldset className="wf-group">
          <legend>{t('wf.employeeForm.groups.identity')}</legend>
          <div className="wf-group-grid">
            <WfField
              label={t('employees.fullName')}
              htmlFor="emp-fullName"
              error={show('fullName')}
              wide
            >
              <input
                id="emp-fullName"
                autoFocus
                maxLength={200}
                value={form.fullName}
                onBlur={blur('fullName')}
                onChange={(e) => update({ fullName: e.target.value })}
                {...aria('fullName')}
              />
            </WfField>
            <WfField
              label={t('employees.deviceId')}
              htmlFor="emp-deviceUserId"
              error={show('deviceUserId')}
              hint={deviceHint}
              wide
            >
              <input
                id="emp-deviceUserId"
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                maxLength={64}
                value={form.deviceUserId}
                onBlur={blur('deviceUserId')}
                onChange={(e) => update({ deviceUserId: e.target.value })}
                {...aria('deviceUserId')}
              />
            </WfField>
            <div className="wf-photo wide">
              <div className="wf-photo-preview">
                {previewUrl ? (
                  <img src={previewUrl} alt={t('employees.photoPreview')} />
                ) : (
                  <span>{initials(form.fullName) || '—'}</span>
                )}
              </div>
              <div className="wf-photo-body">
                <strong>
                  {photoName ||
                    (currentPhotoUrl ? t('employees.currentPhoto') : t('employees.photo'))}
                </strong>
                <small className={photoError ? 'wf-field-error' : 'wf-field-hint'}>
                  {photoError || t('employees.photoHelp')}
                </small>
                <div className="wf-photo-actions">
                  <label className="wf-button ghost small" htmlFor="emp-photo">
                    {previewUrl ? t('employees.replacePhoto') : t('employees.choosePhoto')}
                  </label>
                  {photo && (
                    <button
                      type="button"
                      className="wf-button ghost small"
                      onClick={() => {
                        setPhoto(undefined);
                        setPhotoName('');
                      }}
                    >
                      {t('employees.cancelPhoto')}
                    </button>
                  )}
                </div>
                <input
                  id="emp-photo"
                  className="wf-visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => readPhoto(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset className="wf-group">
          <legend>{t('wf.employeeForm.groups.employment')}</legend>
          <div className="wf-group-grid">
            <WfField
              label={t('employees.hireDate')}
              htmlFor="emp-hireDate"
              error={show('hireDate')}
            >
              <input
                id="emp-hireDate"
                type="date"
                value={form.hireDate}
                onBlur={blur('hireDate')}
                onChange={(e) => update({ hireDate: e.target.value })}
                {...aria('hireDate')}
              />
            </WfField>
            <label className="wf-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => update({ active: e.target.checked })}
              />
              <span>{t('employees.active')}</span>
            </label>
          </div>
          <h3 className="wf-sublegend">{t('wf.employeeForm.groups.pay')}</h3>
          <div className="wf-group-grid">
            <WfField
              label={t('wf.employeeForm.salary')}
              htmlFor="emp-salary"
              error={show('salary')}
              hint={t('wf.employeeForm.salaryHint')}
            >
              <input
                id="emp-salary"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.salary}
                onBlur={blur('salary')}
                onChange={(e) => update({ salary: e.target.value })}
                {...aria('salary')}
              />
            </WfField>
            <WfField
              label={t('employees.wageBasis')}
              htmlFor="emp-wageBasisDays"
              error={show('wageBasisDays')}
              hint={t('wf.employeeForm.wageBasisHint')}
            >
              <input
                id="emp-wageBasisDays"
                type="number"
                min="1"
                max="366"
                inputMode="numeric"
                value={form.wageBasisDays}
                onBlur={blur('wageBasisDays')}
                onChange={(e) => update({ wageBasisDays: e.target.value })}
                {...aria('wageBasisDays')}
              />
            </WfField>
          </div>
        </fieldset>

        <fieldset className="wf-group wide">
          <legend>{t('wf.employeeForm.groups.schedule')}</legend>
          <div className="wf-group-grid three">
            <WfField
              label={t('wf.employeeForm.shift')}
              htmlFor="emp-templateId"
              error={show('templateId')}
              hint={
                selectedTemplate
                  ? `${minuteLabel(selectedTemplate.startMin)} → ${minuteLabel(selectedTemplate.endMin)}`
                  : undefined
              }
            >
              <select
                id="emp-templateId"
                value={form.templateId}
                onChange={(e) => update({ templateId: e.target.value })}
                {...aria('templateId')}
              >
                {templates.length === 0 && (
                  <option value="">{t('wf.employeeForm.noTemplates')}</option>
                )}
                {templates.map((template) => (
                  <option key={template.id} value={template.id} disabled={!template.active}>
                    {template.name}
                  </option>
                ))}
              </select>
            </WfField>
            <WfField
              label={t('wf.employeeForm.weeklyRest')}
              htmlFor="emp-weekday"
              hint={t('wf.employeeForm.weeklyRestHint')}
            >
              <select
                id="emp-weekday"
                value={form.weekday}
                onChange={(e) => update({ weekday: e.target.value })}
              >
                {[6, 7, 1, 2, 3, 4, 5].map((value) => (
                  <option value={value} key={value}>
                    {t(`schedule.weekdays.${value}`)}
                  </option>
                ))}
              </select>
            </WfField>
            <WfField
              label={t('wf.employeeForm.partner')}
              htmlFor="emp-partnerId"
              error={show('partnerId')}
              hint={t('wf.employeeForm.partnerHint')}
            >
              <select
                id="emp-partnerId"
                value={form.partnerId}
                onChange={(e) => update({ partnerId: e.target.value })}
                {...aria('partnerId')}
              >
                <option value="">{t('employees.noCoveragePartner')}</option>
                {employees
                  .filter((item) => item.active && item.id !== employee?.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName} ({item.deviceUserId})
                    </option>
                  ))}
              </select>
            </WfField>
          </div>
          {partner && (
            <div className={`wf-coverage-note${sameRest ? ' warn' : ''}`} aria-live="polite">
              {sameRest ? (
                <p>{t('wf.employeeForm.sameRestWarning', { partner: partner.fullName })}</p>
              ) : (
                <>
                  <p>
                    {t('wf.employeeForm.coverageExplain', {
                      name: form.fullName.trim() || t('wf.employeeForm.thisEmployee'),
                      partner: partner.fullName,
                      partnerRest:
                        partnerSchedule?.weekday != null
                          ? t(`schedule.weekdays.${partnerSchedule.weekday}`)
                          : t('wf.employeeForm.unknownRest'),
                      rest: t(`schedule.weekdays.${form.weekday}`),
                    })}
                  </p>
                  {coverage && (
                    <p>
                      {t('wf.employeeForm.coverageHours')}{' '}
                      <bdi className="wf-time">
                        {minuteLabel(coverage.start)} → {minuteLabel(coverage.end)}
                      </bdi>
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {editing && (
            <div className="wf-group-grid">
              <WfField
                label={t('employees.scheduleEffectiveFrom')}
                htmlFor="emp-effectiveFrom"
                error={show('effectiveFrom')}
                hint={t('employees.scheduleHistoryHelp')}
              >
                <input
                  id="emp-effectiveFrom"
                  type="date"
                  value={form.effectiveFrom}
                  onBlur={blur('effectiveFrom')}
                  onChange={(e) => update({ effectiveFrom: e.target.value })}
                  {...aria('effectiveFrom')}
                />
              </WfField>
              <WfField label={t('common.reason')} htmlFor="emp-reason" error={show('reason')}>
                <input
                  id="emp-reason"
                  maxLength={500}
                  value={form.reason}
                  onBlur={blur('reason')}
                  onChange={(e) => update({ reason: e.target.value })}
                  {...aria('reason')}
                />
              </WfField>
            </div>
          )}
        </fieldset>
      </div>
    </WfDialog>
  );
};
