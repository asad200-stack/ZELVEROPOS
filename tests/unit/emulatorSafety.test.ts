import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertIsolatedEmulatorSafety,
  EMULATOR_PORTS,
  isIsolatedEmulatorMode,
  parseLoopbackHostPort,
  resolveAuthEmulatorHostPort,
  resolveEmulatorHubHostPort,
  resolveFunctionsEmulatorOrigin,
} from '../integration/emulatorSafety';

const root = resolve(import.meta.dirname, '../..');

function isolatedEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ZELVERO_ISOLATED_EMULATORS: '1',
    FUNCTIONS_EMULATOR_HOST: '127.0.0.1:15001',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
    FIREBASE_EMULATOR_HUB: '127.0.0.1:14400',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:19199',
    GCLOUD_PROJECT: 'demo-zelvero',
    ...overrides,
  };
}

describe('emulatorSafety', () => {
  it('keeps primary port map aligned with repository firebase.json', () => {
    const firebase = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8')) as {
      emulators: Record<string, { port?: number }>;
    };
    expect(EMULATOR_PORTS.projectId).toBe('demo-zelvero');
    expect(EMULATOR_PORTS.primary.firestore).toBe(firebase.emulators.firestore.port);
    expect(EMULATOR_PORTS.primary.auth).toBe(firebase.emulators.auth.port);
    expect(EMULATOR_PORTS.primary.functions).toBe(firebase.emulators.functions.port);
    expect(EMULATOR_PORTS.primary.storage).toBe(firebase.emulators.storage.port);
    expect(EMULATOR_PORTS.primary.pubsub).toBe(firebase.emulators.pubsub.port);
    expect(EMULATOR_PORTS.primary.ui).toBe(firebase.emulators.ui.port);
    expect(EMULATOR_PORTS.primary.hub).toBe(4400);
  });

  it('defaults to stock Functions/Auth/Hub endpoints when isolated mode is off', () => {
    expect(isIsolatedEmulatorMode({})).toBe(false);
    expect(resolveFunctionsEmulatorOrigin({})).toBe('http://127.0.0.1:5001');
    expect(resolveAuthEmulatorHostPort({})).toBe('127.0.0.1:9099');
    expect(resolveEmulatorHubHostPort({})).toBe('127.0.0.1:4400');
    expect(assertIsolatedEmulatorSafety({})).toBeNull();
  });

  it('accepts correct isolated endpoints', () => {
    const endpoints = assertIsolatedEmulatorSafety(isolatedEnv(), { requireStorage: true, requireHub: true });
    expect(endpoints).toMatchObject({
      projectId: 'demo-zelvero',
      functions: { origin: 'http://127.0.0.1:15001', port: 15001 },
      firestore: { port: 18080 },
      auth: { port: 19099 },
      hub: { port: 14400 },
      storage: { port: 19199 },
    });
    expect(resolveFunctionsEmulatorOrigin(isolatedEnv())).toBe('http://127.0.0.1:15001');
  });

  it('fails closed when a required isolated endpoint is missing', () => {
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FUNCTIONS_EMULATOR_HOST: undefined }), { requireStorage: true }),
    ).toThrow(/FUNCTIONS_EMULATOR_HOST/);
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FIREBASE_EMULATOR_HUB: undefined }), { requireHub: true }),
    ).toThrow(/FIREBASE_EMULATOR_HUB/);
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FIREBASE_STORAGE_EMULATOR_HOST: undefined, STORAGE_EMULATOR_HOST: undefined }), {
        requireStorage: true,
      }),
    ).toThrow(/FIREBASE_STORAGE_EMULATOR_HOST/);
  });

  it('rejects invalid endpoint format and non-loopback hosts', () => {
    expect(() => parseLoopbackHostPort('not a host', 'FUNCTIONS_EMULATOR_HOST')).toThrow();
    expect(() => parseLoopbackHostPort('127.0.0.1', 'FUNCTIONS_EMULATOR_HOST')).toThrow(/port/);
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FUNCTIONS_EMULATOR_HOST: 'example.com:15001' }), { requireStorage: true }),
    ).toThrow(/loopback/);
  });

  it('rejects primary-stack ports during isolated mode', () => {
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001' }), { requireStorage: true }),
    ).toThrow(/isolated functions port 15001/);
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), { requireStorage: true }),
    ).toThrow(/isolated firestore port 18080/);
    expect(() =>
      assertIsolatedEmulatorSafety(isolatedEnv({ FIREBASE_EMULATOR_HUB: '127.0.0.1:4400' }), { requireHub: true }),
    ).toThrow(/isolated hub port 14400/);
  });

  it('rejects a wrong project id when isolated mode is on', () => {
    expect(() => assertIsolatedEmulatorSafety(isolatedEnv({ GCLOUD_PROJECT: 'zelvoropos' }), { requireStorage: true })).toThrow(
      /demo-zelvero/,
    );
  });
});
