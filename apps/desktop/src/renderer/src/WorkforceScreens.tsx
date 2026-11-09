import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  CalendarDayDto,
  EmployeeDto,
  EmployeeScheduleDto,
  IpcError,
  ShiftTemplateDto,
} from '../../shared/ipc';

const syntheticEmployees: readonly EmployeeDto[] = [
  {
    id: 1,
    fullName: 'Ahmed Hassan',
    deviceUserId: '1',
    hasPhoto: false,
    hireDate: '2025-01-15',
    active: true,
    monthlySalaryMinor: 600_000,
    wageBasisDays: 30,
  },
  {
    id: 2,
    fullName: 'Mariam Adel',
    deviceUserId: '2',
    hasPhoto: false,
    hireDate: '2025-03-01',
    active: true,
    monthlySalaryMinor: 550_000,
    wageBasisDays: 30,
  },
  {
    id: 3,
    fullName: 'Omar Samir',
    deviceUserId: '3',
    hasPhoto: false,
    hireDate: '2025-06-10',
    active: false,
    monthlySalaryMinor: 500_000,
    wageBasisDays: 30,
  },
];

const syntheticTemplates: readonly ShiftTemplateDto[] = [
  {
    id: 1,
    name: 'Morning',
    active: true,
    startMin: 600,
    endMin: 1320,
    inFromMin: 580,
    inToMin: 660,
    outFromMin: 1300,
    outToMin: 1380,
  },
  {
    id: 2,
    name: 'Evening',
    active: true,
    startMin: 780,
    endMin: 1500,
    inFromMin: 760,
    inToMin: 840,
    outFromMin: 1480,
    outToMin: 1560,
  },
];

const errorText = (error: IpcError, t: (key: string) => string): string => t(error.messageKey);
const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
const money = (minor: number, language: string): string =>
  new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(minor / 100);
const minuteLabel = (value: number): string => {
  const day = Math.floor(value / 1440);
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}${day > 0 ? ` +${day}` : ''}`;
};
const timeToMinutes = (value: string, nextDay = false): number => {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes + (nextDay ? 1440 : 0);
};
const minuteToInput = (value: number): string => {
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};

interface ScreenProps {
  isAdmin: boolean;
}

export const EmployeesScreen = ({ isAdmin }: ScreenProps): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [employeePhotoUrls, setEmployeePhotoUrls] = useState<Record<number, string>>({});
  const [templates, setTemplates] = useState<readonly ShiftTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    fullName: '',
    deviceUserId: '',
    hireDate: '',
    salary: '',
    wageBasisDays: '30',
    templateId: '',
    weekday: '6',
    partnerId: '',
    effectiveFrom: '',
    active: true,
    reason: '',
  });
  const [photo, setPhoto] = useState<{
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    dataBase64: string;
  }>();
  const [photoFileName, setPhotoFileName] = useState('');
  const [photoInputVersion, setPhotoInputVersion] = useState(0);
  const resetEmployeeForm = (): void => {
    setEditingEmployeeId(null);
    setForm({
      fullName: '',
      deviceUserId: '',
      hireDate: '',
      salary: '',
      wageBasisDays: '30',
      templateId: String(templates[0]?.id ?? ''),
      weekday: '6',
      partnerId: '',
      effectiveFrom: '',
      active: true,
      reason: '',
    });
    setPhoto(undefined);
    setPhotoFileName('');
    setPhotoInputVersion((value) => value + 1);
  };

  const load = async (): Promise<void> => {
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
      const photoEntries = await Promise.all(
        result.value
          .filter((employee) => employee.hasPhoto)
          .map(async (employee) => {
            const photoResult = await window.dawam!.workforce.getEmployeePhoto({
              employeeId: employee.id,
            });
            return photoResult.ok && photoResult.value
              ? ([
                  employee.id,
                  `data:${photoResult.value.mimeType};base64,${photoResult.value.dataBase64}`,
                ] as const)
              : null;
          }),
      );
      const urls: Record<number, string> = {};
      for (const entry of photoEntries) {
        if (entry) urls[entry[0]] = entry[1];
      }
      setEmployeePhotoUrls(urls);
    } else setMessage(errorText(result.error, t));
    if (templateResult.ok) {
      setTemplates(templateResult.value);
      setForm((current) => ({
        ...current,
        templateId: current.templateId || String(templateResult.value[0]?.id ?? ''),
      }));
    } else setMessage(errorText(templateResult.error, t));
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const readPhoto = (file?: File): void => {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto({
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        dataBase64: String(reader.result).split(',')[1] ?? '',
      });
      setPhotoFileName(file.name);
    };
    reader.readAsDataURL(file);
  };
  const clearSelectedPhoto = (): void => {
    setPhoto(undefined);
    setPhotoFileName('');
    setPhotoInputVersion((value) => value + 1);
  };
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setMessage('');
    if (!window.dawam) {
      setShowForm(false);
      return;
    }
    const input = {
      fullName: form.fullName,
      deviceUserId: form.deviceUserId,
      active: form.active,
      ...(form.hireDate ? { hireDate: form.hireDate } : {}),
      ...(form.salary ? { monthlySalaryMinor: Math.round(Number(form.salary) * 100) } : {}),
      wageBasisDays: Number(form.wageBasisDays),
      ...(photo ? { photo } : {}),
      reason: editingEmployeeId ? form.reason : 'Initial employee record',
    };
    const result = editingEmployeeId
      ? await window.dawam.workforce.updateEmployee({ id: editingEmployeeId, ...input })
      : await window.dawam.workforce.createEmployee(input);
    if (!result.ok) {
      setMessage(errorText(result.error, t));
      return;
    }
    const schedule = await window.dawam.workforce.updateEmployeeSchedule({
      employeeId: result.value.id,
      templateId: Number(form.templateId),
      weekday: Number(form.weekday),
      partnerId: form.partnerId ? Number(form.partnerId) : null,
      effectiveFrom: editingEmployeeId ? form.effectiveFrom : form.hireDate,
      reason: editingEmployeeId ? form.reason : 'Initial employee schedule',
    });
    if (!schedule.ok) {
      setMessage(errorText(schedule.error, t));
      await load();
      return;
    }
    setShowForm(false);
    setEditingEmployeeId(null);
    setForm({
      fullName: '',
      deviceUserId: '',
      hireDate: '',
      salary: '',
      wageBasisDays: '30',
      templateId: String(templates[0]?.id ?? ''),
      weekday: '6',
      partnerId: '',
      effectiveFrom: '',
      active: true,
      reason: '',
    });
    setPhoto(undefined);
    setPhotoFileName('');
    setPhotoInputVersion((value) => value + 1);
    await load();
  };
  const editEmployee = async (item: EmployeeDto): Promise<void> => {
    clearSelectedPhoto();
    let schedule: EmployeeScheduleDto = { templateId: null, weekday: null, partnerId: null };
    if (window.dawam) {
      const result = await window.dawam.workforce.getEmployeeSchedule({
        employeeId: item.id,
        date: currentDate,
      });
      if (!result.ok) {
        setMessage(errorText(result.error, t));
        return;
      }
      schedule = result.value;
    }
    setEditingEmployeeId(item.id);
    setForm({
      fullName: item.fullName,
      deviceUserId: item.deviceUserId,
      hireDate: item.hireDate ?? '',
      salary:
        item.monthlySalaryMinor === undefined || item.monthlySalaryMinor === null
          ? ''
          : String(item.monthlySalaryMinor / 100),
      wageBasisDays: String(item.wageBasisDays ?? 30),
      templateId: String(schedule.templateId ?? templates[0]?.id ?? ''),
      weekday: String(schedule.weekday ?? 6),
      partnerId: schedule.partnerId == null ? '' : String(schedule.partnerId),
      effectiveFrom: currentDate,
      active: item.active,
      reason: '',
    });
    setShowForm(true);
  };
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
    if (!result.ok) setMessage(errorText(result.error, t));
    else {
      setMessage(active ? t('employees.reactivated') : t('employees.archived'));
      await load();
    }
  };
  const deleteEmployee = async (item: EmployeeDto): Promise<void> => {
    if (!window.dawam) return;
    if (!window.confirm(t('employees.deleteConfirm', { name: item.fullName }))) return;
    const result = await window.dawam.workforce.deleteEmployee({
      employeeId: item.id,
      reason: 'Unused employee permanently deleted from employee list',
    });
    if (!result.ok) setMessage(errorText(result.error, t));
    else {
      setMessage(t('employees.deleted'));
      await load();
    }
  };

  return (
    <section className="module-screen">
      <div className="module-header">
        <div>
          <span className="eyebrow">{t('employees.eyebrow')}</span>
          <h1>{t('employees.title')}</h1>
          <p>{t('employees.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            className="module-primary"
            onClick={() => {
              if (showForm) setShowForm(false);
              else {
                resetEmployeeForm();
                setShowForm(true);
              }
            }}
          >
            {showForm ? t('common.close') : t('employees.add')}
          </button>
        )}
      </div>
      {message && <div className="form-error">{message}</div>}
      {showForm && (
        <form className="module-form card" onSubmit={(event) => void submit(event)}>
          <label>
            <span>{t('employees.fullName')}</span>
            <input
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </label>
          <label>
            <span>{t('employees.deviceId')}</span>
            <input
              required
              value={form.deviceUserId}
              onChange={(e) => setForm({ ...form, deviceUserId: e.target.value })}
            />
            <small>{t('employees.deviceIdHelp')}</small>
          </label>
          <label>
            <span>{t('employees.hireDate')}</span>
            <input
              required={!editingEmployeeId}
              type="date"
              value={form.hireDate}
              onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
            />
          </label>
          <label>
            <span>{t('employees.initialShift')}</span>
            <select
              required
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('employees.weeklyOff')}</span>
            <select
              value={form.weekday}
              onChange={(e) => setForm({ ...form, weekday: e.target.value })}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                <option value={value} key={value}>
                  {t(`schedule.weekdays.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('employees.coveragePartner')}</span>
            <select
              value={form.partnerId}
              onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
            >
              <option value="">{t('employees.noCoveragePartner')}</option>
              {employees
                .filter((employee) => employee.active && employee.id !== editingEmployeeId)
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName}
                  </option>
                ))}
            </select>
          </label>
          {editingEmployeeId && (
            <label>
              <span>{t('employees.scheduleEffectiveFrom')}</span>
              <input
                required
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
              <small>{t('employees.scheduleHistoryHelp')}</small>
            </label>
          )}
          <label>
            <span>{t('employees.salary')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.salary}
              onChange={(e) => setForm({ ...form, salary: e.target.value })}
            />
          </label>
          <label>
            <span>{t('employees.wageBasis')}</span>
            <input
              type="number"
              min="1"
              max="366"
              required
              value={form.wageBasisDays}
              onChange={(e) => setForm({ ...form, wageBasisDays: e.target.value })}
            />
          </label>
          <div className="employee-photo-field form-wide">
            <span className="field-label">{t('employees.photo')}</span>
            <div className="employee-photo-picker">
              <div className="employee-photo-preview">
                {photo || (editingEmployeeId && employeePhotoUrls[editingEmployeeId]) ? (
                  <img
                    src={
                      photo
                        ? `data:${photo.mimeType};base64,${photo.dataBase64}`
                        : employeePhotoUrls[editingEmployeeId ?? 0]
                    }
                    alt={t('employees.photoPreview')}
                  />
                ) : (
                  <span>{initials(form.fullName) || '—'}</span>
                )}
              </div>
              <div className="employee-photo-controls">
                <strong>
                  {photoFileName ||
                    (editingEmployeeId && employeePhotoUrls[editingEmployeeId]
                      ? t('employees.currentPhoto')
                      : t('employees.noPhoto'))}
                </strong>
                <small>{t('employees.photoHelp')}</small>
                <div className="employee-photo-actions">
                  <label className="photo-select-button" htmlFor="employee-photo-input">
                    {photo || (editingEmployeeId && employeePhotoUrls[editingEmployeeId])
                      ? t('employees.replacePhoto')
                      : t('employees.choosePhoto')}
                  </label>
                  {photo && (
                    <button
                      type="button"
                      className="photo-clear-button"
                      onClick={clearSelectedPhoto}
                    >
                      {t('employees.cancelPhoto')}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <input
              key={photoInputVersion}
              id="employee-photo-input"
              className="photo-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => readPhoto(e.target.files?.[0])}
            />
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <span>{t('employees.active')}</span>
          </label>
          {editingEmployeeId && (
            <label className="form-wide">
              <span>{t('common.reason')}</span>
              <input
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          )}
          <button className="module-primary" type="submit">
            {t('common.save')}
          </button>
        </form>
      )}
      <div className="table-card card">
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : employees.length === 0 ? (
          <div className="empty-state">{t('employees.empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('employees.employee')}</th>
                <th>{t('employees.deviceId')}</th>
                <th>{t('employees.hireDate')}</th>
                <th>{t('employees.status')}</th>
                {isAdmin && <th>{t('employees.salary')}</th>}
                {isAdmin && <th>{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {employees.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="employee-cell">
                      <span className="employee-avatar">
                        {employeePhotoUrls[item.id] ? (
                          <img src={employeePhotoUrls[item.id]} alt="" />
                        ) : (
                          initials(item.fullName)
                        )}
                      </span>
                      <strong>{item.fullName}</strong>
                    </div>
                  </td>
                  <td>
                    <code>{item.deviceUserId}</code>
                  </td>
                  <td>{item.hireDate ?? '—'}</td>
                  <td>
                    <span className={`status-pill ${item.active ? 'active' : 'inactive'}`}>
                      {item.active ? t('employees.active') : t('employees.inactive')}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      {item.monthlySalaryMinor == null
                        ? '—'
                        : money(item.monthlySalaryMinor, i18n.resolvedLanguage ?? 'ar')}
                    </td>
                  )}
                  {isAdmin && (
                    <td>
                      <div className="table-actions">
                        <button
                          className="table-edit"
                          type="button"
                          onClick={() => void editEmployee(item)}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          className={item.active ? 'table-archive' : 'table-restore'}
                          type="button"
                          onClick={() => void setEmployeeActive(item, !item.active)}
                        >
                          {item.active ? t('employees.archive') : t('employees.reactivate')}
                        </button>
                        {!item.active && (
                          <button
                            className="table-delete"
                            type="button"
                            onClick={() => void deleteEmployee(item)}
                          >
                            {t('employees.deletePermanently')}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};

export const ShiftsScreen = ({ isAdmin }: ScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<readonly ShiftTemplateDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: '',
    start: '10:00',
    end: '22:00',
    inFrom: '09:40',
    inTo: '11:00',
    outFrom: '21:40',
    outTo: '23:00',
    endNext: false,
    inToNext: false,
    outNext: false,
    reason: '',
  });
  const load = async () => {
    if (!window.dawam) {
      setTemplates(syntheticTemplates);
      return;
    }
    const result = await window.dawam.workforce.listTemplates();
    if (result.ok) setTemplates(result.value);
    else setMessage(errorText(result.error, t));
  };
  useEffect(() => {
    void load();
  }, []);
  const recommendedWindows = (start: string, end: string) => {
    const startMinute = timeToMinutes(start);
    const rawEnd = timeToMinutes(end);
    const endNext = rawEnd <= startMinute;
    const endMinute = rawEnd + (endNext ? 1440 : 0);
    const inFrom = Math.max(0, startMinute - 30);
    const inTo = startMinute + 60;
    const outFrom = Math.max(inTo + 1, endMinute - 30);
    const outTo = endMinute + 60;
    return {
      inFrom: minuteToInput(inFrom),
      inTo: minuteToInput(inTo),
      outFrom: minuteToInput(outFrom),
      outTo: minuteToInput(outTo),
      endNext,
      inToNext: inTo >= 1440,
      outNext: outFrom >= 1440,
    };
  };
  const setShiftClocks = (key: 'start' | 'end', value: string): void => {
    const start = key === 'start' ? value : form.start;
    const end = key === 'end' ? value : form.end;
    setForm({ ...form, [key]: value, ...recommendedWindows(start, end) });
  };
  const resetShiftForm = (): void => {
    setEditingId(null);
    setForm({
      name: '',
      start: '10:00',
      end: '22:00',
      inFrom: '09:30',
      inTo: '11:00',
      outFrom: '21:30',
      outTo: '23:00',
      endNext: false,
      inToNext: false,
      outNext: false,
      reason: '',
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.dawam) {
      setShowForm(false);
      return;
    }
    const input = {
      name: form.name,
      active: true,
      startMin: timeToMinutes(form.start),
      endMin: timeToMinutes(form.end, form.endNext),
      inFromMin: timeToMinutes(form.inFrom),
      inToMin: timeToMinutes(form.inTo, form.inToNext),
      outFromMin: timeToMinutes(form.outFrom, form.outNext),
      outToMin: timeToMinutes(form.outTo, form.outNext),
      reason: editingId ? form.reason : 'Initial shift template',
    };
    const result = editingId
      ? await window.dawam.workforce.updateTemplate({ id: editingId, ...input })
      : await window.dawam.workforce.createTemplate(input);
    if (!result.ok) {
      setMessage(errorText(result.error, t));
      return;
    }
    setShowForm(false);
    setEditingId(null);
    await load();
  };
  const edit = (item: ShiftTemplateDto): void => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      start: minuteToInput(item.startMin),
      end: minuteToInput(item.endMin),
      inFrom: minuteToInput(item.inFromMin),
      inTo: minuteToInput(item.inToMin),
      outFrom: minuteToInput(item.outFromMin),
      outTo: minuteToInput(item.outToMin),
      endNext: item.endMin >= 1440,
      inToNext: item.inToMin >= 1440,
      outNext: item.outFromMin >= 1440,
      reason: '',
    });
    setShowForm(true);
  };
  return (
    <section className="module-screen">
      <div className="module-header">
        <div>
          <span className="eyebrow">{t('shifts.eyebrow')}</span>
          <h1>{t('shifts.title')}</h1>
          <p>{t('shifts.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            className="module-primary"
            onClick={() => {
              if (showForm) setShowForm(false);
              else {
                resetShiftForm();
                setShowForm(true);
              }
            }}
          >
            {showForm ? t('common.close') : t('shifts.add')}
          </button>
        )}
      </div>
      {message && <div className="form-error">{message}</div>}
      {showForm && (
        <form className="module-form card" onSubmit={(e) => void submit(e)}>
          <label>
            <span>{t('shifts.name')}</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <div className="shift-form-guide form-wide">
            <div>
              <strong>{t('shifts.shiftSummary')}</strong>
              <span>
                {t('shifts.today')} {form.start} →{' '}
                {form.endNext ? t('shifts.nextDay') : t('shifts.today')} {form.end}
              </span>
            </div>
            <b>
              {t('shifts.durationHours', {
                hours: (timeToMinutes(form.end, form.endNext) - timeToMinutes(form.start)) / 60,
              })}
            </b>
            <button
              className="table-edit"
              type="button"
              onClick={() => setForm({ ...form, ...recommendedWindows(form.start, form.end) })}
            >
              {t('shifts.resetWindows')}
            </button>
          </div>
          {(['start', 'end', 'inFrom', 'inTo', 'outFrom', 'outTo'] as const).map((key) => (
            <label key={key}>
              <span className="time-field-label">
                {t(`shifts.${key}`)}
                <small>
                  {key === 'end' && form.endNext
                    ? t('shifts.nextDay')
                    : key === 'inTo' && form.inToNext
                      ? t('shifts.nextDay')
                      : (key === 'outFrom' || key === 'outTo') && form.outNext
                        ? t('shifts.nextDay')
                        : t('shifts.today')}
                </small>
              </span>
              <input
                type="time"
                required
                value={form[key]}
                onChange={(e) =>
                  key === 'start' || key === 'end'
                    ? setShiftClocks(key, e.target.value)
                    : setForm({ ...form, [key]: e.target.value })
                }
              />
            </label>
          ))}
          {editingId && (
            <label className="form-wide">
              <span>{t('common.reason')}</span>
              <input
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          )}
          <button className="module-primary" type="submit">
            {t('common.save')}
          </button>
        </form>
      )}
      <div className="template-grid">
        {templates.map((item) => (
          <article className="template-card card" key={item.id}>
            <div className="template-title">
              <span className="shift-dot"></span>
              <div>
                <h2>{item.name}</h2>
                <span>{item.active ? t('shifts.active') : t('shifts.inactive')}</span>
              </div>
              {isAdmin && (
                <button className="template-edit" type="button" onClick={() => edit(item)}>
                  {t('common.edit')}
                </button>
              )}
            </div>
            <div className="template-main-time">
              <strong>{minuteLabel(item.startMin)}</strong>
              <span>→</span>
              <strong>{minuteLabel(item.endMin)}</strong>
            </div>
            <div className="window-list">
              <div>
                <span>{t('shifts.inWindow')}</span>
                <b>
                  {minuteLabel(item.inFromMin)} – {minuteLabel(item.inToMin)}
                </b>
              </div>
              <div>
                <span>{t('shifts.outWindow')}</span>
                <b>
                  {minuteLabel(item.outFromMin)} – {minuteLabel(item.outToMin)}
                </b>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export const ScheduleScreen = (): React.JSX.Element => {
  const { i18n, t } = useTranslation();
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [employees, setEmployees] = useState<readonly EmployeeDto[]>([]);
  const [selected, setSelected] = useState(0);
  const [month, setMonth] = useState(defaultMonth);
  const [days, setDays] = useState<readonly CalendarDayDto[]>([]);
  const [message, setMessage] = useState('');
  const loadBase = async () => {
    if (!window.dawam) {
      setEmployees(syntheticEmployees);
      setSelected(1);
      return;
    }
    const people = await window.dawam.workforce.listEmployees();
    if (people.ok) {
      setEmployees(people.value);
      setSelected((current) => current || people.value[0]?.id || 0);
    }
  };
  useEffect(() => {
    void loadBase();
  }, []);
  useEffect(() => {
    const load = async () => {
      if (!selected) return;
      if (!window.dawam) {
        const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
        setDays(
          Array.from({ length: count }, (_, i) => ({
            date: `${month}-${String(i + 1).padStart(2, '0')}`,
            kind: i % 7 === 5 ? 'REST' : 'SHIFT',
            source: i % 7 === 5 ? 'weekly_rest' : 'assignment',
            ...(i % 7 === 5 ? {} : { templateName: i % 2 ? 'Evening' : 'Morning' }),
          })),
        );
        return;
      }
      const result = await window.dawam.workforce.calendar({ employeeId: selected, month });
      if (result.ok) setDays(result.value);
      else setMessage(errorText(result.error, t));
    };
    void load();
  }, [selected, month]);
  const weekday = (date: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage === 'en' ? 'en-EG' : 'ar-EG', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  return (
    <section className="module-screen">
      <div className="module-header">
        <div>
          <span className="eyebrow">{t('schedule.eyebrow')}</span>
          <h1>{t('schedule.title')}</h1>
          <p>{t('schedule.subtitle')}</p>
        </div>
        <div className="schedule-selectors">
          <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
            {employees.map((item) => (
              <option value={item.id} key={item.id}>
                {item.fullName}
              </option>
            ))}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>
      {message && (
        <div className={message === t('schedule.saved') ? 'success-note' : 'form-error'}>
          {message}
        </div>
      )}
      <div className="schedule-source-note card">{t('schedule.manageFromEmployee')}</div>
      <div className="calendar-grid">
        {days.map((day, index) => (
          <article
            className={`calendar-day ${day.kind.toLowerCase()}`}
            key={day.date}
            style={
              index === 0
                ? {
                    gridColumnStart: ((new Date(`${day.date}T12:00:00Z`).getUTCDay() + 1) % 7) + 1,
                  }
                : undefined
            }
          >
            <header>
              <strong>{day.date.slice(-2)}</strong>
              <span>{weekday(day.date)}</span>
            </header>
            <div>
              <span className="calendar-chip">
                {day.leaveKind ? t(`schedule.${day.leaveKind}`) : t(`schedule.kinds.${day.kind}`)}
              </span>
              {day.templateName && <small>{day.templateName}</small>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
