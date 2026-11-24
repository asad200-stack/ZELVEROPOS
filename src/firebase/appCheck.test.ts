import { describe, expect, it } from 'vitest';
import { installAppCheckDebugFlag, isPublicStorePath, shouldInitializeAppCheck } from './appCheck';

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

describe('isPublicStorePath', () => {
  it('matches a shop website only', () => {
    expect(isPublicStorePath('/s/todayslook')).toBe(true);
    expect(isPublicStorePath('/s/todayslook/')).toBe(true);
    expect(isPublicStorePath('/app/0.9.3/s/zelvero-mobile')).toBe(true);
    expect(isPublicStorePath('/online-store')).toBe(false);
    expect(isPublicStorePath('/app/0.9.3/settings')).toBe(false);
    expect(isPublicStorePath('/sales/s')).toBe(false);
  });
});
