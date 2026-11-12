import { describe, expect, it } from 'vitest';
import {
  armFunctionQuiet,
  emptyFunctionActivity,
  functionActivityIdle,
  messageFromLog,
  noteFunctionLog,
  pendingFunctionCount,
  UnmatchedFunctionFinish,
} from '../integration/functionActivity';

describe('function activity', () => {
  it('keeps a checkout trigger pending until that execution finishes', () => {
    const state = emptyFunctionActivity();
    noteFunctionLog(state, 'Beginning execution of "europe-west1-posCheckout"', 1_000);
    noteFunctionLog(state, 'Finished "europe-west1-posCheckout" in 40ms', 1_040);
    noteFunctionLog(state, 'Beginning execution of "europe-west1-onSaleCreated"', 1_050);
    expect(pendingFunctionCount(state)).toBe(1);
    expect(functionActivityIdle(state, 1_050 + 500, 500)).toBe(false);
  });

  it('counts overlapping executions and rejects an unmatched finish', () => {
    const state = emptyFunctionActivity();
    noteFunctionLog(state, 'Beginning execution of "europe-west1-posCheckout"', 1_000);
    noteFunctionLog(state, 'Beginning execution of "europe-west1-posCheckout"', 1_010);
    noteFunctionLog(state, 'Finished "europe-west1-posCheckout" in 18ms', 1_020);
    expect(pendingFunctionCount(state)).toBe(1);
    expect(() => noteFunctionLog(state, 'Finished "europe-west1-onSaleCreated" in 4ms', 1_030)).toThrow(UnmatchedFunctionFinish);
    noteFunctionLog(state, 'Finished "europe-west1-posCheckout" in 20ms', 1_040);
    expect(pendingFunctionCount(state)).toBe(0);
    expect(state.quietArmedAt).toBe(1_040);
    expect(functionActivityIdle(state, 1_539, 500)).toBe(false);
    expect(functionActivityIdle(state, 1_540, 500)).toBe(true);
  });

  it('does not treat an old log timestamp or socket silence as idle', () => {
    const state = emptyFunctionActivity();
    expect(functionActivityIdle(state, 10_000, 500)).toBe(false);
    armFunctionQuiet(state, 10_000);
    expect(functionActivityIdle(state, 10_499, 500)).toBe(false);
    expect(functionActivityIdle(state, 10_500, 500)).toBe(true);
  });

  it('reads the logging emulator payload without using its stored timestamp', () => {
    const raw = JSON.stringify({
      message: 'i  functions: ignored',
      timestamp: 50,
      data: { metadata: { message: 'Beginning execution of "europe-west1-posCheckout"' } },
    });
    expect(messageFromLog(raw)).toBe('Beginning execution of "europe-west1-posCheckout"');
  });
});
