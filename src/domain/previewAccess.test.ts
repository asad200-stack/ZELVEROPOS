import { describe, expect, it } from 'vitest';
import { customerReleaseCutoverAllowed } from './previewAccess';

describe('preview release separation', () => {
  it('blocks customer cutover from the preview build and leaves it available otherwise', () => {
    expect(customerReleaseCutoverAllowed(true)).toBe(false);
    expect(customerReleaseCutoverAllowed(false)).toBe(true);
  });
});
