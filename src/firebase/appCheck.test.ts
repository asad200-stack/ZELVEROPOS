import { describe, expect, it } from 'vitest';
import { installAppCheckDebugFlag, shouldInitializeAppCheck } from './appCheck';

describe('App Check init policy', () => {
  it('stays off on emulators even when a site key is present', () => {
    expect(shouldInitializeAppCheck({ appCheckSiteKey: 'site-key', useEmulators: true })).toBe(false);
  });

  it('starts in production only with a public site key', () => {
    expect(shouldInitializeAppCheck({ appCheckSiteKey: '', useEmulators: false })).toBe(false);
    expect(shouldInitializeAppCheck({ appCheckSiteKey: 'site-key', useEmulators: false })).toBe(true);
  });

  it('never installs a debug token outside DEV, and never stores a secret token value', () => {
    expect(installAppCheckDebugFlag(false, 'true')).toBe(false);
    expect(installAppCheckDebugFlag(true, 'secret-token')).toBe(false);
    expect(installAppCheckDebugFlag(true, 'true')).toBe(true);
    expect((globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });
});
