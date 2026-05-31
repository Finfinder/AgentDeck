import { describe, expect, it } from 'vitest';

import { FS_AMBIENT } from '../../packages/services/src/fs-ambient';

describe('coverage helpers', () => {
  it('fs ambient exported', () => {
    expect(FS_AMBIENT).toBe(true);
  });
});
