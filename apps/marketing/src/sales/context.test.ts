import { describe, expect, it } from 'vitest';
import { withContext } from './context';

describe('AI sales context', () => {
  it('carries industry and features into form URLs without storing the chat', () => {
    const to = withContext('/quote', {
      businessType: 'mobile-electronics',
      interestedFeatures: ['inventory', 'credit', 'suppliers'],
    });
    expect(to).toContain('businessType=mobile-electronics');
    expect(to).toContain('inventory');
    expect(to).toContain('credit');
    expect(to).not.toMatch(/how do i sell/i);
  });
});
