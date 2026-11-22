import { describe, expect, it } from 'vitest';
import { needsPlainOrtBuild } from './ortAssets';

describe('needsPlainOrtBuild', () => {
  const safari18 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

  it('uses the plain build only on older Safari without WebGPU', () => {
    expect(needsPlainOrtBuild(safari18, false)).toBe(true);
    expect(needsPlainOrtBuild(safari18, true)).toBe(false);
    expect(needsPlainOrtBuild(chrome, false)).toBe(false);
    expect(needsPlainOrtBuild(safari18.replace('Version/18.2', 'Version/26.1'), false)).toBe(false);
  });
});
