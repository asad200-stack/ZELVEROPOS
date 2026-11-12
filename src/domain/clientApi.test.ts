import { describe, expect, it } from 'vitest';
import { clientApiAllowed } from './release';

describe('API compatibility', () => {
  it('lets current and legacy clients through and rejects older APIs as UPDATE_REQUIRED', () => {
    expect(clientApiAllowed(undefined, 1, 1)).toBe(true);
    expect(clientApiAllowed(1, 1, 1)).toBe(true);
    expect(clientApiAllowed(0, 1, 1)).toBe(false);
  });
});
