import { describe, expect, it } from 'vitest';

import { validateAdjacentTemplates, validateShiftTemplate } from '../src/index.js';
import { evening, morning } from './helpers.js';

describe('shift template validation', () => {
  it('accepts the seeded shifts', () => {
    expect(validateShiftTemplate(morning).ok).toBe(true);
    expect(validateShiftTemplate(evening).ok).toBe(true);
  });

  it('collects malformed field and window errors', () => {
    const result = validateShiftTemplate({
      ...morning,
      id: '',
      name: '',
      startMin: 700.5,
      endMin: 600,
      inFromMin: 700,
      inToMin: 650,
      outFromMin: 640,
      outToMin: 2200,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((error) => error.code)).toEqual(
        expect.arrayContaining([
          'EMPTY_ID',
          'EMPTY_NAME',
          'NON_INTEGER_OFFSET',
          'INVALID_SHIFT_RANGE',
          'INVALID_IN_WINDOW',
          'WINDOWS_OVERLAP',
          'ADJACENT_DAY_WINDOWS_OVERLAP',
        ]),
      );
    }
  });

  it('rejects punch windows that overlap the following day', () => {
    expect(validateAdjacentTemplates({ ...evening, outToMin: 2100 }, morning)).toEqual({
      ok: false,
      error: { code: 'ADJACENT_DAY_WINDOWS_OVERLAP' },
    });
    expect(validateAdjacentTemplates(morning, evening).ok).toBe(true);
  });

  it('rejects an open-ended OUT cap that reaches the next IN window', () => {
    expect(
      validateAdjacentTemplates({ ...evening, outToMin: null, otCapMin: 800 }, morning),
    ).toEqual({
      ok: false,
      error: { code: 'ADJACENT_DAY_WINDOWS_OVERLAP' },
    });
  });
});
