import { describe, expect, it } from 'vitest';
import { POS_ORIGIN } from '../constants';
import { nextMenuOpen } from '../nav/menu';
import { CTAS, DEMO_LIVE } from './ctas';
import { PARTNER_BENEFITS, PARTNER_TOOLKIT } from './partners';

describe('owner polish conversion paths', () => {
  it('keeps a single set of primary CTA labels and routes', () => {
    expect(CTAS.trial).toEqual({ to: '/trial', label: 'Start Free Trial' });
    expect(CTAS.demo).toEqual({ to: '/demo', label: 'Explore Demo' });
    expect(CTAS.preview).toEqual({ to: '/product', label: 'Preview ZELVERO' });
    expect(CTAS.quote).toEqual({ to: '/quote', label: 'Get a Quote' });
    expect(CTAS.sales).toEqual({ to: '/contact', label: 'Talk to Sales' });
    expect(CTAS.partner).toEqual({ to: '/partners', label: 'Become a Partner' });
  });

  it('does not pretend the live demo tenant exists', () => {
    expect(DEMO_LIVE).toBe(false);
  });

  it('exposes partner program CTAs and toolkit without a public revenue split', () => {
    expect(CTAS.partnerProgram.to).toBe('/partners#program');
    expect(PARTNER_BENEFITS).toContain('Commission tracking');
    expect(PARTNER_TOOLKIT.map((c) => c.title)).toEqual([
      'Demo Link',
      'Free Trial Link',
      'Sales Brochure',
      'Product Screenshots',
      'Social Media Content',
      'Quote Requests',
      'Lead Tracking',
    ]);
    expect(JSON.stringify(PARTNER_BENEFITS) + JSON.stringify(PARTNER_TOOLKIT)).not.toMatch(/\d+\s*%/);
  });

  it('does not retarget production POS origins', () => {
    expect(POS_ORIGIN).toBe('https://zelvoropos.web.app');
  });

  it('keeps mobile menu close-on-navigate behavior', () => {
    expect(nextMenuOpen(true, 'navigate')).toBe(false);
  });
});
