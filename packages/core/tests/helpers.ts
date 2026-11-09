import type {
  ResolvedSchedule,
  ScheduleContext,
  ShiftInstance,
  ShiftTemplate,
} from '../src/index.js';
import { createShiftInstance } from '../src/index.js';

export const morning: ShiftTemplate = {
  id: 'morning',
  name: 'Morning',
  startMin: 600,
  endMin: 1320,
  inFromMin: 580,
  inToMin: 660,
  outFromMin: 1300,
  outToMin: 1380,
};

export const evening: ShiftTemplate = {
  id: 'evening',
  name: 'Evening',
  startMin: 780,
  endMin: 1500,
  inFromMin: 760,
  inToMin: 840,
  outFromMin: 1480,
  outToMin: 1560,
};

export const emptyContext = (): ScheduleContext => ({
  templates: [morning, evening],
  assignments: [],
  weeklyRest: [],
  overrides: [],
  pairs: [],
  leaves: [],
});

export const shiftSchedule = (
  date = '2026-11-09',
  template: ShiftTemplate = morning,
): ResolvedSchedule => ({
  employeeId: 'E1',
  date,
  kind: 'SHIFT',
  source: 'assignment',
  template,
});

export const instanceFor = (
  date = '2026-11-09',
  template: ShiftTemplate = morning,
): ShiftInstance => {
  const result = createShiftInstance(shiftSchedule(date, template));
  if (!result.ok || !result.value) throw new Error('Expected valid shift instance');
  return result.value;
};
