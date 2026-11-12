import { describe, expect, it } from 'vitest';
import { localSpeechSupported, pickRecorderMimeType } from './localWhisper';

describe('localWhisper helpers', () => {
  it('reports unsupported outside a browser MediaRecorder environment', () => {
    expect(localSpeechSupported()).toBe(false);
    expect(pickRecorderMimeType()).toBeUndefined();
  });
});
