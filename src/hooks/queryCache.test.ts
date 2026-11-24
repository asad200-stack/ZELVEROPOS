import { describe, expect, it } from 'vitest';
import { clearQueryCache, readQueryCache, writeQueryCache } from './queryCache';

describe('queryCache', () => {
  it('keeps the last value per key and forgets everything on clear', () => {
    writeQueryCache('a', 1);
    writeQueryCache('a', 2);
    expect(readQueryCache<number>('a')).toBe(2);
    clearQueryCache();
    expect(readQueryCache('a')).toBeUndefined();
  });

  it('drops the oldest entry once full', () => {
    clearQueryCache();
    for (let i = 0; i <= 60; i++) writeQueryCache(`k${i}`, i);
    expect(readQueryCache('k0')).toBeUndefined();
    expect(readQueryCache<number>('k60')).toBe(60);
  });
});
