import { describe, expect, it } from 'vitest';
import { resolveFunctionsEmulatorOrigin } from '../integration/emulatorSafety';

describe('resolveFunctionsEmulatorOrigin', () => {
  it('defaults to the stock emulator port', () => {
    expect(resolveFunctionsEmulatorOrigin({})).toBe('http://127.0.0.1:5001');
  });

  it('accepts host:port and full loopback URLs', () => {
    expect(resolveFunctionsEmulatorOrigin({ FUNCTIONS_EMULATOR_HOST: '127.0.0.1:15001' })).toBe('http://127.0.0.1:15001');
    expect(resolveFunctionsEmulatorOrigin({ FUNCTIONS_EMULATOR_HOST: 'http://127.0.0.1:15001' })).toBe(
      'http://127.0.0.1:15001',
    );
    expect(resolveFunctionsEmulatorOrigin({ FUNCTIONS_EMULATOR_HOST: 'localhost:15001' })).toBe('http://localhost:15001');
  });

  it('rejects non-loopback and malformed values', () => {
    expect(() => resolveFunctionsEmulatorOrigin({ FUNCTIONS_EMULATOR_HOST: 'example.com:5001' })).toThrow(/loopback/);
    expect(() => resolveFunctionsEmulatorOrigin({ FUNCTIONS_EMULATOR_HOST: '127.0.0.1' })).toThrow(/port/);
    expect(() => resolveFunctionsEmulatorOrigin({ FUNCTIONS_EMULATOR_HOST: 'not a host' })).toThrow();
  });

  it('requires the isolated Functions port when isolated mode is enabled', () => {
    expect(() => resolveFunctionsEmulatorOrigin({ ZELVERO_ISOLATED_EMULATORS: '1' })).toThrow(/FUNCTIONS_EMULATOR_HOST/);
    expect(() =>
      resolveFunctionsEmulatorOrigin({ ZELVERO_ISOLATED_EMULATORS: '1', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001' }),
    ).toThrow(/15001/);
    expect(
      resolveFunctionsEmulatorOrigin({ ZELVERO_ISOLATED_EMULATORS: '1', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:15001' }),
    ).toBe('http://127.0.0.1:15001');
  });
});
