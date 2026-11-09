import { describe, expect, it } from 'vitest';

import { DAWAM_TIME_ZONE } from '../src/index.js';

describe('core bootstrap', () => {
  it('uses the documented business time zone', () => {
    expect(DAWAM_TIME_ZONE).toBe('Africa/Cairo');
  });
});
