import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE } from '../constants';
import { playSound, resetSoundForTests, setSoundEnabled, soundEnabled, soundPlayCount } from './engine';

const mem: Record<string, string> = {};
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (k in mem ? mem[k] : null),
      setItem: (k: string, v: string) => {
        mem[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
    },
  });
}

describe('sound', () => {
  afterEach(() => {
    try {
      localStorage.removeItem(STORAGE.sound);
    } catch {
      /* node */
    }
    resetSoundForTests();
  });

  it('defaults to on and never autoplays', () => {
    expect(soundEnabled()).toBe(true);
    expect(soundPlayCount()).toBe(0);
  });

  it('mutes immediately and persists', () => {
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
    playSound('primary');
    expect(soundPlayCount()).toBe(0);
    expect(localStorage.getItem(STORAGE.sound)).toBe('off');
  });
});
