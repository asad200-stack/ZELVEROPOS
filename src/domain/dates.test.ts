import { describe, expect, it } from 'vitest';
import { addDays, daysUntil, expiryState, localDate, presetRange } from './dates';

describe('dates', () => {
  const now = new Date(2026, 8, 29, 15, 30);

  it('formats local business dates', () => {
    expect(localDate(now)).toBe('2026-09-29');
    expect(addDays('2026-09-29', 3)).toBe('2026-10-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('computes preset ranges', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-09-29', to: '2026-09-29' });
    expect(presetRange('week', now)).toEqual({ from: '2026-09-23', to: '2026-09-29' });
    expect(presetRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-29' });
    expect(presetRange('lastMonth', now)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('classifies expiry dates', () => {
    expect(daysUntil('2026-10-01', now)).toBe(2);
    expect(expiryState('2026-09-28', 30, now)).toBe('expired');
    expect(expiryState('2026-10-10', 30, now)).toBe('soon');
    expect(expiryState('2027-01-01', 30, now)).toBe('ok');
    expect(expiryState(null, 30, now)).toBe('none');
  });
});
