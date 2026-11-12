import { describe, expect, it } from 'vitest';
import { menuAria, nextMenuOpen } from './menu';

describe('mobile menu', () => {
  it('toggles, closes on navigate, and closes on Escape', () => {
    expect(nextMenuOpen(false, 'toggle')).toBe(true);
    expect(nextMenuOpen(true, 'toggle')).toBe(false);
    expect(nextMenuOpen(true, 'escape')).toBe(false);
    expect(nextMenuOpen(true, 'navigate')).toBe(false);
  });

  it('exposes aria state for keyboard users', () => {
    expect(menuAria(false)).toEqual({ expanded: false, label: 'Open menu' });
    expect(menuAria(true)).toEqual({ expanded: true, label: 'Close menu' });
  });
});
