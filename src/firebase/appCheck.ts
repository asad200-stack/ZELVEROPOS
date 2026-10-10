import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';
import type { ResolvedFirebaseConfig } from './config';

let instance: AppCheck | null | undefined;

export function shouldInitializeAppCheck(config: Pick<ResolvedFirebaseConfig, 'appCheckSiteKey' | 'useEmulators'>): boolean {
  return Boolean(config.appCheckSiteKey) && !config.useEmulators;
}

/**
 * Debug tokens must never be committed. In local DEV only, `VITE_FIREBASE_APPCHECK_DEBUG=true`
 * (gitignored .env.local) lets the SDK print a one-time token to register in the Firebase console.
 * Production builds ignore the flag (`import.meta.env.DEV` is false).
 */
export function installAppCheckDebugFlag(dev: boolean, debugFlag: string | undefined): boolean {
  if (!dev || debugFlag !== 'true') return false;
  (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  return true;
}

/** Starts App Check once. Emulators skip it. Monitoring-only: enforcement is a console setting, not set here. */
export function initAppCheck(app: FirebaseApp, config: ResolvedFirebaseConfig): AppCheck | null {
  if (instance !== undefined) return instance;
  if (!shouldInitializeAppCheck(config)) {
    instance = null;
    return null;
  }
  installAppCheckDebugFlag(import.meta.env.DEV, import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG as string | undefined);
  instance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return instance;
}

export function resetAppCheckForTests(): void {
  instance = undefined;
  delete (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN;
}
