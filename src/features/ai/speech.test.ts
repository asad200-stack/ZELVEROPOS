import { describe, expect, it } from 'vitest';
import { containsArabicScript, resolveSpeechLocale, transcriptMayNeedArabicCorrection } from './speech';
import { speechLocaleFallbackChain } from './speechErrors';

describe('speech locale and script helpers', () => {
  it('listens in Arabic even when the UI is English, so spoken Arabic is not Latinized', () => {
    expect(resolveSpeechLocale('ar')).toBe('ar');
    expect(resolveSpeechLocale('en')).toBe('ar');
  });

  it('documents Arabic locale fallback order with ar-LB last', () => {
    expect(speechLocaleFallbackChain(resolveSpeechLocale('ar'))).toEqual(['ar', 'ar-SA', 'ar-EG', 'ar-LB']);
  });

  it('detects Arabic script without rewriting Latin text', () => {
    expect(containsArabicScript('شاحن Type-C')).toBe(true);
    expect(containsArabicScript('Type-C charger')).toBe(false);
    expect(transcriptMayNeedArabicCorrection('keef bzid product', 'ar')).toBe(true);
    expect(transcriptMayNeedArabicCorrection('كيف بضيف منتج', 'ar')).toBe(false);
    expect(transcriptMayNeedArabicCorrection('Add a charger', 'en')).toBe(false);
  });
});
