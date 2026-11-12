import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('integration storage emulator', () => {
  it('runs account-deletion cleanup against the local storage emulator only', () => {
    const script = readFileSync(resolve(root, 'scripts/run-integration.mjs'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const firebase = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8')) as {
      emulators: { storage: { port: number } };
    };

    const ports = JSON.parse(readFileSync(resolve(root, 'tests/integration/emulatorPorts.json'), 'utf8')) as {
      primary: { storage: number };
    };
    expect(pkg.scripts['test:integration']).toContain('scripts/run-integration.mjs');
    expect(script).toContain('--only auth,firestore,functions,pubsub,storage');
    expect(script).toContain('ports.primary.storage');
    expect(script).toContain('STORAGE_EMULATOR_HOST');
    expect(script).toContain('ZELVERO_FIREBASE_CONFIG');
    expect(script).toContain('FUNCTIONS_EMULATOR_HOST');
    expect(script).toContain('emulatorPorts.json');
    expect(script).toContain('isolatedModeEnv');
    expect(script).not.toContain('googleapis.com');
    expect(script).not.toContain('storage.google');
    expect(firebase.emulators.storage.port).toBe(9199);
    expect(ports.primary.storage).toBe(9199);
  });
});