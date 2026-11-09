import type { Result, ShiftTemplate } from './types.js';

export type TemplateErrorCode =
  | 'EMPTY_ID'
  | 'EMPTY_NAME'
  | 'NON_INTEGER_OFFSET'
  | 'INVALID_SHIFT_RANGE'
  | 'INVALID_IN_WINDOW'
  | 'INVALID_OUT_WINDOW'
  | 'WINDOWS_OVERLAP'
  | 'ADJACENT_DAY_WINDOWS_OVERLAP';

export interface TemplateError {
  code: TemplateErrorCode;
  field?: keyof ShiftTemplate;
}

const offsets = (template: ShiftTemplate): number[] => [
  template.startMin,
  template.endMin,
  template.inFromMin,
  template.inToMin,
  template.outFromMin,
  template.outToMin,
];

export const validateShiftTemplate = (
  template: ShiftTemplate,
): Result<ShiftTemplate, readonly TemplateError[]> => {
  const errors: TemplateError[] = [];
  if (!template.id.trim()) errors.push({ code: 'EMPTY_ID', field: 'id' });
  if (!template.name.trim()) errors.push({ code: 'EMPTY_NAME', field: 'name' });
  if (!offsets(template).every(Number.isInteger)) errors.push({ code: 'NON_INTEGER_OFFSET' });
  if (template.endMin <= template.startMin) errors.push({ code: 'INVALID_SHIFT_RANGE' });
  if (template.inFromMin > template.inToMin) errors.push({ code: 'INVALID_IN_WINDOW' });
  if (template.outFromMin > template.outToMin) errors.push({ code: 'INVALID_OUT_WINDOW' });
  if (template.inToMin >= template.outFromMin) errors.push({ code: 'WINDOWS_OVERLAP' });
  if (template.outToMin >= template.inFromMin + 1440) {
    errors.push({ code: 'ADJACENT_DAY_WINDOWS_OVERLAP' });
  }
  return errors.length > 0 ? { ok: false, error: errors } : { ok: true, value: template };
};

export const validateAdjacentTemplates = (
  previous: ShiftTemplate,
  next: ShiftTemplate,
): Result<true, TemplateError> => {
  if (previous.outToMin >= next.inFromMin + 1440) {
    return { ok: false, error: { code: 'ADJACENT_DAY_WINDOWS_OVERLAP' } };
  }
  return { ok: true, value: true };
};
