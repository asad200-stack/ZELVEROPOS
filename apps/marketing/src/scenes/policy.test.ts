import { describe, expect, it } from 'vitest';
import { hero3dPaused, shouldLoadHero3d } from './policy';

describe('hero 3d policy', () => {
  it('turns off for reduced motion, missing WebGL, or save-data', () => {
    expect(shouldLoadHero3d({ reducedMotion: true, webgl: true, mobile: false, saveData: false, cores: 8 })).toBe('off');
    expect(shouldLoadHero3d({ reducedMotion: false, webgl: false, mobile: false, saveData: false, cores: 8 })).toBe('off');
    expect(shouldLoadHero3d({ reducedMotion: false, webgl: true, mobile: false, saveData: true, cores: 8 })).toBe('off');
  });

  it('simplifies on mobile or low-core devices', () => {
    expect(shouldLoadHero3d({ reducedMotion: false, webgl: true, mobile: true, saveData: false, cores: 8 })).toBe('simple');
    expect(shouldLoadHero3d({ reducedMotion: false, webgl: true, mobile: false, saveData: false, cores: 4 })).toBe('simple');
    expect(shouldLoadHero3d({ reducedMotion: false, webgl: true, mobile: false, saveData: false, cores: 8 })).toBe('full');
  });

  it('pauses when the tab is hidden', () => {
    expect(hero3dPaused(true, false)).toBe(true);
    expect(hero3dPaused(false, true)).toBe(true);
    expect(hero3dPaused(false, false)).toBe(false);
  });
});
