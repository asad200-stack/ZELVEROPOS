/**
 * Maps Web Speech API error codes to a single user-facing outcome.
 * Keeps the raw engine code for diagnostics — never invents transcripts.
 *
 * Important about `network`:
 * In Chromium this usually means the browser could not complete its cloud speech-service
 * round-trip. That is NOT the same as "the device is offline."
 * Chromium also often reports weak/unsupported BCP-47 tags (e.g. ar-LB) as `network`
 * instead of `language-not-supported`, so a single-pass locale fallback is allowed when
 * there is still no transcript.
 */

export type SpeechErrorStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'error';

export type SpeechErrorReason =
  | 'final'
  | 'ended-with-transcript'
  | 'no-speech'
  | 'aborted'
  | 'error'
  | 'permission-denied';

export type SpeechFeedbackKey =
  | 'ai.micDenied'
  | 'ai.speechNoSpeech'
  | 'ai.speechNetwork'
  | 'ai.speechAudioCapture'
  | 'ai.speechLanguageUnsupported'
  | 'ai.speechError'
  | 'ai.speechUnsupported'
  | 'ai.voiceDisabled'
  | 'ai.speechLoadingModel'
  | 'ai.speechTranscribing'
  | 'ai.speechLocalFailed';

export interface SpeechErrorClassification {
  reason: SpeechErrorReason;
  status: SpeechErrorStatus;
  messageKey: SpeechFeedbackKey | null;
}

export function isLocaleFallbackEligible(errorCode: string | undefined): boolean {
  return errorCode === 'language-not-supported' || errorCode === 'network';
}

export function classifySpeechError(code: string | undefined): SpeechErrorClassification {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { reason: 'permission-denied', status: 'permission-denied', messageKey: 'ai.micDenied' };
    case 'no-speech':
    case 'no-match':
      return { reason: 'no-speech', status: 'no-speech', messageKey: 'ai.speechNoSpeech' };
    case 'aborted':
      return { reason: 'aborted', status: 'idle', messageKey: null };
    case 'network':
      return { reason: 'error', status: 'error', messageKey: 'ai.speechNetwork' };
    case 'audio-capture':
      return { reason: 'error', status: 'error', messageKey: 'ai.speechAudioCapture' };
    case 'language-not-supported':
      return { reason: 'error', status: 'error', messageKey: 'ai.speechLanguageUnsupported' };
    case 'local-whisper-failed':
      return { reason: 'error', status: 'error', messageKey: 'ai.speechLocalFailed' };
    case 'bad-grammar':
    case 'start-failed':
    case undefined:
    case '':
      return { reason: 'error', status: 'error', messageKey: 'ai.speechError' };
    default:
      return { reason: 'error', status: 'error', messageKey: 'ai.speechError' };
  }
}

/** Preview channels keep typed chat. Voice stays off until a real microphone test succeeds. */
export function voiceInputAvailable(channel: string | undefined): boolean {
  return channel !== 'preview' && channel !== 'superadmin-preview';
}

/**
 * Only a finished Web Speech result with no error code may replace the composer.
 * Partials, whisper-tiny, and any failed recognition stay out.
 */
export function shouldCommitSpeechTranscript(outcome: {
  reason: SpeechErrorReason;
  errorCode?: string;
  engine?: string;
  lastTranscript?: string;
}): boolean {
  return (
    outcome.reason === 'final' &&
    outcome.engine === 'web-speech' &&
    !outcome.errorCode &&
    Boolean(outcome.lastTranscript?.trim())
  );
}

export function speechOutcomeMessageKey(outcome: {
  reason: SpeechErrorReason;
  errorCode?: string;
}): SpeechFeedbackKey | null {
  if (outcome.reason === 'final' || outcome.reason === 'ended-with-transcript' || outcome.reason === 'aborted') {
    return null;
  }
  if (outcome.reason === 'permission-denied') return 'ai.micDenied';
  if (outcome.reason === 'no-speech') return 'ai.speechNoSpeech';
  return classifySpeechError(outcome.errorCode).messageKey;
}

export function speechLocaleFallbackChain(preferred: string): string[] {
  if (preferred === 'en-US' || preferred.startsWith('en')) {
    return preferred === 'en-US' ? ['en-US'] : [preferred, 'en-US'];
  }
  // Prefer broadly supported Arabic tags first. ar-LB is last: Chromium often fails it as `network`.
  const arabic = ['ar', 'ar-SA', 'ar-EG', 'ar-LB'];
  const rest = arabic.filter((tag) => tag !== preferred);
  return preferred.startsWith('ar') ? [preferred, ...rest] : [preferred, ...arabic];
}

export function speechEnvironmentHints(): {
  secureContext: boolean | null;
  browserReportsOnline: boolean | null;
} {
  if (typeof window === 'undefined') {
    return { secureContext: null, browserReportsOnline: null };
  }
  return {
    secureContext: typeof window.isSecureContext === 'boolean' ? window.isSecureContext : null,
    browserReportsOnline: typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
  };
}

export function logSpeechDiagnostic(event: string, detail: Record<string, unknown>): void {
  console.info(`[ai-speech] ${event}`, detail);
}
