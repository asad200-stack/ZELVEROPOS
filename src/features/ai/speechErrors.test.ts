/**
 * Unit tests for Web Speech error → UI mapping and duplicate-suppression helpers.
 * MOCKED classification only — does not exercise a real microphone.
 */
import { describe, expect, it } from 'vitest';
import {
  classifySpeechError,
  isLocaleFallbackEligible,
  speechLocaleFallbackChain,
  shouldCommitSpeechTranscript,
  speechOutcomeMessageKey,
  voiceInputAvailable,
} from './speechErrors';

describe('classifySpeechError', () => {
  it('maps permission codes', () => {
    expect(classifySpeechError('not-allowed')).toMatchObject({
      reason: 'permission-denied',
      messageKey: 'ai.micDenied',
    });
    expect(classifySpeechError('service-not-allowed')).toMatchObject({
      reason: 'permission-denied',
      messageKey: 'ai.micDenied',
    });
  });

  it('maps no-speech / no-match without using the generic failure copy', () => {
    expect(classifySpeechError('no-speech').messageKey).toBe('ai.speechNoSpeech');
    expect(classifySpeechError('no-match').messageKey).toBe('ai.speechNoSpeech');
  });

  it('stays quiet for aborted (normal stop / supersede)', () => {
    expect(classifySpeechError('aborted')).toMatchObject({ reason: 'aborted', messageKey: null });
  });

  it('maps network, audio-capture, and language-not-supported distinctly', () => {
    expect(classifySpeechError('network').messageKey).toBe('ai.speechNetwork');
    expect(classifySpeechError('audio-capture').messageKey).toBe('ai.speechAudioCapture');
    expect(classifySpeechError('language-not-supported').messageKey).toBe('ai.speechLanguageUnsupported');
  });

  it('allows locale fallback for language-not-supported and Chromium network misreports', () => {
    expect(isLocaleFallbackEligible('language-not-supported')).toBe(true);
    expect(isLocaleFallbackEligible('network')).toBe(true);
    expect(isLocaleFallbackEligible('no-speech')).toBe(false);
    expect(isLocaleFallbackEligible('not-allowed')).toBe(false);
    expect(isLocaleFallbackEligible(undefined)).toBe(false);
  });

  it('falls back to generic speechError for unknown codes', () => {
    expect(classifySpeechError('weird-engine-code').messageKey).toBe('ai.speechError');
    expect(classifySpeechError(undefined).messageKey).toBe('ai.speechError');
  });
});

describe('speechOutcomeMessageKey (single visible message)', () => {
  it('returns null for success and aborted so status UI does not double-render', () => {
    expect(speechOutcomeMessageKey({ reason: 'final' })).toBeNull();
    expect(speechOutcomeMessageKey({ reason: 'ended-with-transcript' })).toBeNull();
    expect(speechOutcomeMessageKey({ reason: 'aborted' })).toBeNull();
  });

  it('uses errorCode for accurate failure copy', () => {
    expect(speechOutcomeMessageKey({ reason: 'error', errorCode: 'network' })).toBe('ai.speechNetwork');
    expect(speechOutcomeMessageKey({ reason: 'error', errorCode: 'audio-capture' })).toBe('ai.speechAudioCapture');
    expect(speechOutcomeMessageKey({ reason: 'no-speech' })).toBe('ai.speechNoSpeech');
    expect(speechOutcomeMessageKey({ reason: 'permission-denied' })).toBe('ai.micDenied');
  });
});

describe('speech transcript commit', () => {
  it('keeps only a finished Web Speech result with no error', () => {
    expect(
      shouldCommitSpeechTranscript({
        reason: 'final',
        engine: 'web-speech',
        lastTranscript: 'Add soap for 3 dollars',
      }),
    ).toBe(true);
    expect(
      shouldCommitSpeechTranscript({
        reason: 'final',
        engine: 'web-speech',
        errorCode: 'network',
        lastTranscript: 'أجل أن أتمنّر',
      }),
    ).toBe(false);
    expect(
      shouldCommitSpeechTranscript({
        reason: 'final',
        engine: 'local-whisper',
        lastTranscript: 'أجل أن أتمنّر',
      }),
    ).toBe(false);
    expect(
      shouldCommitSpeechTranscript({
        reason: 'error',
        engine: 'web-speech',
        errorCode: 'network',
        lastTranscript: 'partial guess',
      }),
    ).toBe(false);
  });

  it('turns voice off for the isolated previews', () => {
    expect(voiceInputAvailable('preview')).toBe(false);
    expect(voiceInputAvailable('superadmin-preview')).toBe(false);
    expect(voiceInputAvailable('production')).toBe(true);
    expect(voiceInputAvailable(undefined)).toBe(true);
  });
});

describe('speechLocaleFallbackChain', () => {
  it('tries broader Arabic tags first and keeps ar-LB last', () => {
    expect(speechLocaleFallbackChain('ar')).toEqual(['ar', 'ar-SA', 'ar-EG', 'ar-LB']);
    expect(speechLocaleFallbackChain('ar-LB')).toEqual(['ar-LB', 'ar', 'ar-SA', 'ar-EG']);
  });

  it('keeps en-US as a single attempt', () => {
    expect(speechLocaleFallbackChain('en-US')).toEqual(['en-US']);
  });
});
