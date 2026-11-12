import { describe, expect, it } from 'vitest';
import { TRIAL_PROVISIONING_ACTIVE, validateTrial } from './model';

describe('trial', () => {
  it('keeps website trial forms wired, with public signup gated on the server', () => {
    expect(TRIAL_PROVISIONING_ACTIVE).toBe(true);
  });

  it('validates required visitor fields', () => {
    expect(validateTrial({})).toContain('business');
    expect(
      validateTrial({
        business: 'Shop',
        owner: 'Ada',
        email: 'bad',
        phone: '1',
        type: 'general-retail',
        country: 'LB',
        currency: 'USD',
        password: 'short',
      }),
    ).toEqual(['email', 'password']);
    expect(
      validateTrial({
        business: 'Shop',
        owner: 'Ada',
        email: 'ada@shop.co',
        phone: '1',
        type: 'general-retail',
        country: 'LB',
        currency: 'USD',
        password: 'longpass1',
      }),
    ).toEqual([]);
  });
});
