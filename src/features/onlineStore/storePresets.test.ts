import { describe, expect, it } from 'vitest';
import { defaultBranding } from '@/domain/onlineStore';
import { applyPreset, matchingKind, STORE_KINDS, STORE_PRESETS } from './storePresets';

describe('store presets', () => {
  it('sets the look and fills only empty headline texts', () => {
    const base = { ...defaultBranding('Shop'), heroTitle: 'My own title' };
    const out = applyPreset(base, 'perfume');
    expect(out.theme).toBe('perfume');
    expect(out.primaryColor).toBe('#C9A46A');
    expect(out.heroTitle).toBe('My own title');
    expect(out.heroCta).toBe(STORE_PRESETS.perfume.copy.ar.cta);
    expect(out.sections).toContain('catalog');
  });

  it('uses the store language for the suggested texts', () => {
    const out = applyPreset({ ...defaultBranding('Shop'), defaultLocale: 'en' }, 'food');
    expect(out.heroTitle).toBe(STORE_PRESETS.food.copy.en.title);
    expect(out.template).toBe('restaurant');
  });

  it('recognises the preset a draft is on, and every preset keeps the catalogue', () => {
    expect(matchingKind(applyPreset(defaultBranding('S'), 'shoes'))).toBe('shoes');
    for (const k of STORE_KINDS) expect(STORE_PRESETS[k].sections).toContain('catalog');
  });
});
