import { describe, expect, it } from 'vitest';
import { isBlockedProjectId, validateFirebaseEnv } from './isolation';

const complete = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'zelvero-pos-prod.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'zelvero-pos-prod',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
  VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvero-pos-prod',
};

const fatal = (env: Record<string, string>, requireComplete = true) =>
  validateFirebaseEnv(env, { requireComplete }).filter((p) => p.fatal);

describe('firebase isolation guard', () => {
  it('blocks the old CATCH POS project ids', () => {
    expect(isBlockedProjectId('pos-catch')).toBe(true);
    expect(isBlockedProjectId(' POS-CATCH-TEST ')).toBe(true);
    expect(isBlockedProjectId('zelvero-pos-prod')).toBe(false);
  });

  it('accepts a complete configuration for a new project', () => {
    expect(fatal(complete)).toEqual([]);
  });

  it('rejects the old project, its domains and its project number', () => {
    expect(fatal({ ...complete, VITE_FIREBASE_PROJECT_ID: 'pos-catch', VITE_EXPECTED_FIREBASE_PROJECT_ID: 'pos-catch' })).not.toEqual([]);
    expect(fatal({ ...complete, VITE_FIREBASE_AUTH_DOMAIN: 'pos-catch.firebaseapp.com' })).not.toEqual([]);
    expect(fatal({ ...complete, VITE_FIREBASE_STORAGE_BUCKET: 'pos-catch.appspot.com' })).not.toEqual([]);
    expect(fatal({ ...complete, VITE_FIREBASE_MESSAGING_SENDER_ID: '891436013106' })).not.toEqual([]);
  });

  it('requires the expected project id to match and rejects placeholders', () => {
    expect(fatal({ ...complete, VITE_EXPECTED_FIREBASE_PROJECT_ID: 'something-else' })).not.toEqual([]);
    expect(fatal({ ...complete, VITE_FIREBASE_PROJECT_ID: 'zelvero-pos-REPLACE-ME', VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvero-pos-REPLACE-ME' })).not.toEqual(
      [],
    );
  });

  it('emulator mode only allows demo-* projects', () => {
    expect(fatal({ VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-zelvero' })).toEqual([]);
    expect(fatal({ VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'zelvero-pos-prod' })).not.toEqual([]);
  });

  it('missing values are fatal only for builds', () => {
    expect(fatal({}, false)).toEqual([]);
    expect(fatal({}, true)).not.toEqual([]);
  });
});
