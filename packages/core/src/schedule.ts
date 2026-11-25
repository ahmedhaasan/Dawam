import { buildShiftWindow, isDateInRange, isValidLocalDate, isoWeekday } from './time.js';
import type {
  ApprovedLeave,
  EmployeeId,
  ResolvedSchedule,
  Result,
  ScheduleContext,
  ScheduleOverride,
  ShiftAssignment,
  ShiftInstance,
  ShiftTemplate,
  TeammatePair,
} from './types.js';

export type ScheduleErrorCode =
  | 'INVALID_DATE'
  | 'MISSING_TEMPLATE'
  | 'MULTIPLE_ASSIGNMENTS'
  | 'MULTIPLE_ACTIVE_PAIRS'
  | 'INVALID_SHIFT_OVERRIDE'
  | 'COVERAGE_TEMPLATE_MISSING';

export interface ScheduleError {
  code: ScheduleErrorCode;
  employeeId: EmployeeId;
  date: string;
  templateId?: string;
}

const activeAssignments = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
): readonly ShiftAssignment[] =>
  context.assignments.filter(
    (assignment) =>
      assignment.employeeId === employeeId &&
      isDateInRange(date, assignment.validFrom, assignment.validTo),
  );

const assignedTemplate = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
): Result<ShiftTemplate | null, ScheduleError> => {
  const assignments = activeAssignments(employeeId, date, context);
  if (assignments.length > 1) {
    return { ok: false, error: { code: 'MULTIPLE_ASSIGNMENTS', employeeId, date } };
  }
  const assignment = assignments[0];
  if (!assignment) return { ok: true, value: null };
  const template = context.templates.find((item) => item.id === assignment.templateId);
  if (!template) {
    return {
      ok: false,
      error: {
        code: 'MISSING_TEMPLATE',
        employeeId,
        date,
        templateId: assignment.templateId,
      },
    };
  }
  return { ok: true, value: template };
};

const overrideFor = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
): ScheduleOverride | undefined =>
  context.overrides.find(
    (override) => override.employeeId === employeeId && override.date === date,
  );

const leaveFor = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
): ApprovedLeave | undefined =>
  context.leaves.find(
    (leave) => leave.employeeId === employeeId && isDateInRange(date, leave.dateFrom, leave.dateTo),
  );

const hasWeeklyRest = (employeeId: EmployeeId, date: string, context: ScheduleContext): boolean => {
  const weekday = isoWeekday(date);
  if (weekday === null) return false;
  return context.weeklyRest.some(
    (rule) =>
      rule.employeeId === employeeId &&
      rule.weekday === weekday &&
      isDateInRange(date, rule.validFrom, rule.validTo),
  );
};

const isBaseRest = (employeeId: EmployeeId, date: string, context: ScheduleContext): boolean => {
  const override = overrideFor(employeeId, date, context);
  if (override?.kind === 'rest') return true;
  if (override?.kind === 'shift' || override?.kind === 'work_default') return false;
  return hasWeeklyRest(employeeId, date, context);
};

const activePair = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
): Result<TeammatePair | null, ScheduleError> => {
  const pairs = context.pairs.filter(
    (pair) =>
      (pair.employeeA === employeeId || pair.employeeB === employeeId) &&
      isDateInRange(date, pair.validFrom, pair.validTo),
  );
  if (pairs.length > 1) {
    return { ok: false, error: { code: 'MULTIPLE_ACTIVE_PAIRS', employeeId, date } };
  }
  return { ok: true, value: pairs[0] ?? null };
};

const mergeCoverageTemplate = (
  employeeTemplate: ShiftTemplate,
  partnerTemplate: ShiftTemplate,
): ShiftTemplate => {
  const earlier =
    employeeTemplate.startMin <= partnerTemplate.startMin ? employeeTemplate : partnerTemplate;
  const later =
    employeeTemplate.endMin >= partnerTemplate.endMin ? employeeTemplate : partnerTemplate;
  return {
    id: `coverage:${earlier.id}+${later.id}`,
    name: `${earlier.name} + ${later.name}`,
    startMin: earlier.startMin,
    endMin: later.endMin,
    inFromMin: earlier.inFromMin,
    inToMin: earlier.inToMin,
    outFromMin: later.outFromMin,
    outToMin: later.outToMin,
    lateGraceMin: earlier.lateGraceMin ?? 0,
    checkoutOpenBeforeEndMin: later.checkoutOpenBeforeEndMin ?? 10,
    otCapMin: later.otCapMin ?? 480,
  };
};

const attachLeave = (schedule: ResolvedSchedule, context: ScheduleContext): ResolvedSchedule => {
  if (schedule.kind !== 'SHIFT' && schedule.kind !== 'COVERAGE') return schedule;
  const leave = leaveFor(schedule.employeeId, schedule.date, context);
  return leave ? { ...schedule, leaveKind: leave.kind } : schedule;
};

const scheduledFromAssignment = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
  source: 'assignment' | 'override',
): Result<ResolvedSchedule, ScheduleError> => {
  const template = assignedTemplate(employeeId, date, context);
  if (!template.ok) return template;
  if (!template.value) {
    return {
      ok: true,
      value: { employeeId, date, kind: 'NO_SCHEDULE', source: 'none' },
    };
  }
  return {
    ok: true,
    value: attachLeave(
      { employeeId, date, kind: 'SHIFT', source, template: template.value },
      context,
    ),
  };
};

export const resolveSchedule = (
  employeeId: EmployeeId,
  date: string,
  context: ScheduleContext,
): Result<ResolvedSchedule, ScheduleError> => {
  if (!isValidLocalDate(date)) {
    return { ok: false, error: { code: 'INVALID_DATE', employeeId, date } };
  }

  const override = overrideFor(employeeId, date, context);
  if (override?.kind === 'rest') {
    return {
      ok: true,
      value: { employeeId, date, kind: 'REST', source: 'override' },
    };
  }
  if (override?.kind === 'shift') {
    if (!override.templateId) {
      return { ok: false, error: { code: 'INVALID_SHIFT_OVERRIDE', employeeId, date } };
    }
    const template = context.templates.find((item) => item.id === override.templateId);
    if (!template) {
      return {
        ok: false,
        error: {
          code: 'MISSING_TEMPLATE',
          employeeId,
          date,
          templateId: override.templateId,
        },
      };
    }
    return {
      ok: true,
      value: attachLeave(
        { employeeId, date, kind: 'SHIFT', source: 'override', template },
        context,
      ),
    };
  }
  if (override?.kind === 'work_default') {
    return scheduledFromAssignment(employeeId, date, context, 'override');
  }
  if (override?.kind === 'cancel_coverage') {
    if (hasWeeklyRest(employeeId, date, context)) {
      return {
        ok: true,
        value: { employeeId, date, kind: 'REST', source: 'weekly_rest' },
      };
    }
    return scheduledFromAssignment(employeeId, date, context, 'override');
  }

  const pair = activePair(employeeId, date, context);
  if (!pair.ok) return pair;
  if (pair.value) {
    const partnerId =
      pair.value.employeeA === employeeId ? pair.value.employeeB : pair.value.employeeA;
    const ownRest = isBaseRest(employeeId, date, context);
    const partnerRest = isBaseRest(partnerId, date, context);

    if (ownRest && partnerRest) {
      return {
        ok: true,
        value: {
          employeeId,
          date,
          kind: 'COVERAGE_NEEDED',
          source: 'coverage_needed',
          partnerId,
        },
      };
    }
    if (ownRest) {
      return {
        ok: true,
        value: {
          employeeId,
          date,
          kind: 'REST',
          source: 'weekly_rest',
          partnerId,
        },
      };
    }
    if (partnerRest) {
      const ownTemplate = assignedTemplate(employeeId, date, context);
      if (!ownTemplate.ok) return ownTemplate;
      const teammateTemplate = assignedTemplate(partnerId, date, context);
      if (!teammateTemplate.ok) return teammateTemplate;
      if (!ownTemplate.value || !teammateTemplate.value) {
        return {
          ok: false,
          error: { code: 'COVERAGE_TEMPLATE_MISSING', employeeId, date },
        };
      }
      return {
        ok: true,
        value: attachLeave(
          {
            employeeId,
            date,
            kind: 'COVERAGE',
            source: 'coverage',
            partnerId,
            template: mergeCoverageTemplate(ownTemplate.value, teammateTemplate.value),
          },
          context,
        ),
      };
    }
  }

  if (hasWeeklyRest(employeeId, date, context)) {
    return {
      ok: true,
      value: { employeeId, date, kind: 'REST', source: 'weekly_rest' },
    };
  }
  return scheduledFromAssignment(employeeId, date, context, 'assignment');
};

export const createShiftInstance = (
  schedule: ResolvedSchedule,
): Result<ShiftInstance | null, ScheduleError> => {
  if ((schedule.kind !== 'SHIFT' && schedule.kind !== 'COVERAGE') || !schedule.template) {
    return { ok: true, value: null };
  }
  const window = buildShiftWindow(schedule.date, schedule.template);
  if (!window.ok) {
    return {
      ok: false,
      error: {
        code: 'INVALID_DATE',
        employeeId: schedule.employeeId,
        date: schedule.date,
      },
    };
  }
  const base: ShiftInstance = {
    employeeId: schedule.employeeId,
    date: schedule.date,
    scheduleKind: schedule.kind,
    template: schedule.template,
    window: window.value,
  };
  return {
    ok: true,
    value: schedule.leaveKind ? { ...base, leaveKind: schedule.leaveKind } : base,
  };
};
