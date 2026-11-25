import type { EmployeeDto, IpcError, ShiftTemplateDto } from '../../shared/ipc';

export const DAY_MIN = 1440;

export const syntheticEmployees: readonly EmployeeDto[] = [
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

export const syntheticTemplates: readonly ShiftTemplateDto[] = [
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
    lateGraceMin: 0,
    checkoutOpenBeforeEndMin: 10,
    otCapMin: 480,
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
    lateGraceMin: 0,
    checkoutOpenBeforeEndMin: 10,
    otCapMin: 480,
  },
];

export const errorText = (error: IpcError, t: (key: string) => string): string =>
  t(error.messageKey);

export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

export const money = (minor: number, language: string): string =>
  new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(minor / 100);

/** Clock text (HH:mm) of a minute offset, ignoring the day part. */
export const clockText = (offset: number): string => {
  const minute = ((offset % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};

/** Day shift of a minute offset relative to the shift start date (0 = same day, 1 = next day). */
export const dayShift = (offset: number): number => Math.floor(offset / DAY_MIN);

/** HH:mm with a +1 / −1 day suffix when the offset leaves the shift start date. */
export const minuteLabel = (offset: number): string => {
  const day = dayShift(offset);
  return `${clockText(offset)}${day > 0 ? ` +${day}` : day < 0 ? ` ${day}` : ''}`;
};

export const parseClock = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/** Places a wall-clock time on the day (−1, 0, +1 …) closest to the anchor offset. */
export const nearestOffset = (clock: number, anchor: number): number => {
  const day = Math.round((anchor - clock) / DAY_MIN);
  return clock + day * DAY_MIN;
};

/** Effective end of the accepted checkout zone (open-ended zones use the overtime cap). */
export const outZoneEnd = (template: Pick<ShiftTemplateDto, 'endMin' | 'outToMin' | 'otCapMin'>) =>
  template.outToMin ?? template.endMin + template.otCapMin;
