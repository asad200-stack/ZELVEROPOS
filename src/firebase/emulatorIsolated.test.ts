import { describe, expect, it } from 'vitest';
import { FirebaseConfigError, resolveFirebaseConfigFromEnv } from './config';
import {
  ISOLATED_DEMO_PROJECT_ID,
  ISOLATED_EMULATOR_DEFAULT_PORTS,
  resolveIsolatedEmulatorEndpoints,
  validateEmulatorIsolatedEnv,
} from './emulatorIsolated';

const isolatedOk = {
  VITE_EMULATOR_ISOLATED: 'true',
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_PROJECT_ID: 'demo-zelvero',
  VITE_EXPECTED_FIREBASE_PROJECT_ID: 'demo-zelvero',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-zelvero.firebaseapp.com',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-zelvero.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000',
  VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '19099',
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '18080',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '15001',
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: '19199',
};

const productionOk = {
  VITE_USE_FIREBASE_EMULATORS: 'false',
  VITE_FIREBASE_API_KEY: 'prod-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
  VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '111111111111',
  VITE_FIREBASE_APP_ID: '1:111:web:abc',
  VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
};

const stagingOk = {
  VITE_USE_FIREBASE_EMULATORS: 'false',
  VITE_FIREBASE_API_KEY: 'stage-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos-stage.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
  VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos-stage.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '222222222222',
  VITE_FIREBASE_APP_ID: '1:222:web:def',
  VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
};

const primaryEmulatorOk = {
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_PROJECT_ID: 'demo-zelvero',
  VITE_EXPECTED_FIREBASE_PROJECT_ID: 'demo-zelvero',
};

describe('isolated emulator harness defaults', () => {
  it('uses alternate ports Auth 19099 / Firestore 18080 / Functions 15001 / Storage 19199', () => {
    expect(ISOLATED_DEMO_PROJECT_ID).toBe('demo-zelvero');
    expect(ISOLATED_EMULATOR_DEFAULT_PORTS).toEqual({
      auth: 19099,
      firestore: 18080,
      functions: 15001,
      storage: 19199,
    });
  });
});

describe('validateEmulatorIsolatedEnv', () => {
  it('is a no-op when isolated mode is off', () => {
    expect(validateEmulatorIsolatedEnv(productionOk)).toEqual([]);
    expect(validateEmulatorIsolatedEnv(primaryEmulatorOk)).toEqual([]);
  });

  it('accepts correct demo-zelvero isolated configuration', () => {
    expect(validateEmulatorIsolatedEnv(isolatedOk)).toEqual([]);
    const endpoints = resolveIsolatedEmulatorEndpoints(isolatedOk);
    expect(endpoints.authOrigin).toBe('http://127.0.0.1:19099');
    expect(endpoints.firestorePort).toBe(18080);
    expect(endpoints.functionsPort).toBe(15001);
    expect(endpoints.storagePort).toBe(19199);
  });

  it('rejects production project id', () => {
    const problems = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
    });
    expect(problems.some((p) => p.fatal && /zelvoropos|demo-zelvero/i.test(p.message))).toBe(true);
  });

  it('rejects staging project id', () => {
    const problems = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
    });
    expect(problems.some((p) => p.fatal && /zelvoropos-stage|demo-zelvero/i.test(p.message))).toBe(true);
  });

  it('allows another demo project only when the env names that exact id', () => {
    const denied = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_PROJECT_ID: 'demo-zelvero-featurecenter',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'demo-zelvero-featurecenter',
      VITE_FIREBASE_AUTH_EMULATOR_PORT: '19309',
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '18380',
      VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '15311',
      VITE_FIREBASE_STORAGE_EMULATOR_PORT: '19319',
    });
    expect(denied.some((problem) => problem.fatal)).toBe(true);
    const allowed = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_PROJECT_ID: 'demo-zelvero-featurecenter',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'demo-zelvero-featurecenter',
      VITE_EMULATOR_ALLOW_DEMO_PROJECT: 'demo-zelvero-featurecenter',
      VITE_FIREBASE_AUTH_EMULATOR_PORT: '19309',
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '18380',
      VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '15311',
      VITE_FIREBASE_STORAGE_EMULATOR_PORT: '19319',
    });
    expect(allowed).toEqual([]);
    const cloud = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
      VITE_EMULATOR_ALLOW_DEMO_PROJECT: 'zelvoropos',
    });
    expect(cloud.some((problem) => problem.fatal)).toBe(true);
  });

  it('rejects any unknown project id', () => {
    const problems = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_PROJECT_ID: 'customer-other-pos',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'customer-other-pos',
    });
    expect(problems.some((p) => p.fatal && p.message.includes('demo-zelvero'))).toBe(true);
  });

  it('rejects missing emulator flag', () => {
    const problems = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_USE_FIREBASE_EMULATORS: 'false',
    });
    expect(problems.some((p) => /VITE_USE_FIREBASE_EMULATORS/i.test(p.message))).toBe(true);
  });

  it('rejects invalid ports', () => {
    expect(
      validateEmulatorIsolatedEnv({ ...isolatedOk, VITE_FIREBASE_AUTH_EMULATOR_PORT: 'not-a-port' }).length,
    ).toBeGreaterThan(0);
    expect(
      validateEmulatorIsolatedEnv({ ...isolatedOk, VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '0' }).length,
    ).toBeGreaterThan(0);
    expect(
      validateEmulatorIsolatedEnv({ ...isolatedOk, VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '70000' }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects primary-suite port collision', () => {
    const problems = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
    });
    expect(problems.some((p) => /primary Emulator Suite/i.test(p.message))).toBe(true);
  });

  it('rejects cloud Firebase configuration embedded in domains', () => {
    const problems = validateEmulatorIsolatedEnv({
      ...isolatedOk,
      VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos.firebaseapp.com',
    });
    expect(problems.some((p) => /cloud project/i.test(p.message))).toBe(true);
  });

  it('uses safe defaults when port env keys are omitted', () => {
    const { VITE_FIREBASE_AUTH_EMULATOR_PORT: _a, VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: _f, ...rest } = isolatedOk;
    expect(validateEmulatorIsolatedEnv(rest)).toEqual([]);
    expect(resolveIsolatedEmulatorEndpoints(rest).ports).toEqual(ISOLATED_EMULATOR_DEFAULT_PORTS);
  });
});

describe('resolveFirebaseConfigFromEnv with isolated harness', () => {
  it('accepts isolated demo-zelvero and exposes endpoints', () => {
    const cfg = resolveFirebaseConfigFromEnv(isolatedOk);
    expect(cfg.projectId).toBe('demo-zelvero');
    expect(cfg.useEmulators).toBe(true);
    expect(cfg.isolatedEmulators).toBe(true);
    expect(cfg.isolatedEndpoints?.ports.auth).toBe(19099);
    expect(cfg.isolatedEndpoints?.ports.firestore).toBe(18080);
  });

  it('throws on production project under isolated flag', () => {
    expect(() =>
      resolveFirebaseConfigFromEnv({
        ...isolatedOk,
        VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
        VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
      }),
    ).toThrow(FirebaseConfigError);
  });
});

describe('production and staging initialization paths remain unchanged', () => {
  it('resolves production without isolated endpoints or emulator connect', () => {
    const cfg = resolveFirebaseConfigFromEnv(productionOk);
    expect(cfg.projectId).toBe('zelvoropos');
    expect(cfg.useEmulators).toBe(false);
    expect(cfg.isolatedEmulators).toBe(false);
    expect(cfg.isolatedEndpoints).toBeNull();
    expect(cfg.options.projectId).toBe('zelvoropos');
  });

  it('resolves staging without isolated endpoints or emulator connect', () => {
    const cfg = resolveFirebaseConfigFromEnv(stagingOk);
    expect(cfg.projectId).toBe('zelvoropos-stage');
    expect(cfg.useEmulators).toBe(false);
    expect(cfg.isolatedEmulators).toBe(false);
    expect(cfg.isolatedEndpoints).toBeNull();
  });

  it('keeps primary emulator mode on stock path (no isolated endpoints)', () => {
    const cfg = resolveFirebaseConfigFromEnv(primaryEmulatorOk);
    expect(cfg.useEmulators).toBe(true);
    expect(cfg.isolatedEmulators).toBe(false);
    expect(cfg.isolatedEndpoints).toBeNull();
    expect(cfg.projectId).toBe('demo-zelvero');
  });
});
