/**
 * Speech-to-text adapter for Zelvero AI.
 *
 * Browser Web Speech API (Chrome/Edge cloud) when reachable.
 * A failed or unverified result is not a transcript. whisper-tiny is not used:
 * a real microphone test produced repeated Arabic that was not what was spoken,
 * and that model is not a Lebanese Arabic recognizer.
 * Audio is never uploaded to a paid transcription API.
 */

import {
  localSpeechSupported,
  pickRecorderMimeType,
  transcribeAudioBlob,
  warmLocalWhisper,
} from './localWhisper';
import {
  classifySpeechError,
  isLocaleFallbackEligible,
  logSpeechDiagnostic,
  speechEnvironmentHints,
  speechLocaleFallbackChain,
} from './speechErrors';

export type SpeechStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'loading-model'
  | 'transcribing'
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'error';

export interface SpeechResult {
  transcript: string;
  /** True when the engine marked the result as final. */
  isFinal: boolean;
}

/** Terminal outcome for one push-to-talk session (always fired once per successful start). */
export type SpeechSessionOutcome = {
  status: SpeechStatus;
  reason: 'final' | 'ended-with-transcript' | 'no-speech' | 'aborted' | 'error' | 'permission-denied';
  lastTranscript: string;
  errorCode?: string;
  /** Locale / engine actually used for the session that ended. */
  langUsed?: string;
  engine?: 'web-speech' | 'local-whisper';
};

export interface SpeechAdapter {
  readonly supported: boolean;
  readonly lang: string;
  status: SpeechStatus;
  /**
   * Start push-to-talk. `onPartial` receives interim/final transcripts.
   * `onDone` always runs once when the engine ends or errors (so the UI cannot stay stuck listening).
   * `onStatus` mirrors interim status for loading / local recording.
   */
  start(
    onPartial: (result: SpeechResult) => void,
    onDone?: (outcome: SpeechSessionOutcome) => void,
    onStatus?: (status: SpeechStatus) => void,
  ): Promise<void>;
  stop(): void;
  cancel(): void;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onnomatch: ((event: unknown) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

const NETWORK_FAIL_KEY = 'zelvero.ai.speech.preferLocal';
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const root = (typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null) as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  } | null;
  if (!root) return null;
  return root.SpeechRecognition ?? root.webkitSpeechRecognition ?? null;
}

function clearPreferLocal(): void {
  try {
    sessionStorage.removeItem(NETWORK_FAIL_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Voice always listens in Arabic, even when the UI is English.
 * Chrome's en-US recognizer writes Arabic speech as Latin ("مرحبا" → "Marha").
 */
export function resolveSpeechLocale(_uiLang: 'ar' | 'en'): string {
  return 'ar';
}

export function resolveUiLangFromSpeechHint(langHint: string): 'ar' | 'en' {
  return langHint.startsWith('ar') ? 'ar' : 'en';
}

/**
 * Ask for mic access. Keeps the stream when `keepStream` is true (local recorder path).
 */
export async function ensureMicAccess(keepStream = false): Promise<
  { ok: true; stream?: MediaStream } | { ok: false; reason: 'denied' | 'unavailable' }
> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return keepStream ? { ok: false, reason: 'unavailable' } : { ok: true };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!keepStream) {
      for (const track of stream.getTracks()) track.stop();
      return { ok: true };
    }
    return { ok: true, stream };
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return { ok: false, reason: 'denied' };
    }
    return { ok: false, reason: 'unavailable' };
  }
}

export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

export function transcriptMayNeedArabicCorrection(text: string, uiLang: 'ar' | 'en'): boolean {
  if (uiLang !== 'ar') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (containsArabicScript(trimmed)) return false;
  return /[A-Za-z]{3,}/.test(trimmed);
}

function accumulateTranscript(event: SpeechRecognitionEventLike): { transcript: string; isFinal: boolean } {
  let transcript = '';
  let isFinal = false;
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const row = event.results[i];
    if (!row) continue;
    transcript += row[0]?.transcript ?? '';
    if (row.isFinal) isFinal = true;
  }
  return { transcript: transcript.trim(), isFinal };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Push-to-talk through Web Speech. Failed recognition does not fall through to on-device Whisper. */
export function createBrowserSpeechAdapter(langHint = 'en-US'): SpeechAdapter {
  const Ctor = getSpeechRecognitionCtor();
  const uiLang = resolveUiLangFromSpeechHint(langHint);
  const canLocal = localSpeechSupported();
  let recognition: SpeechRecognitionLike | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let recordedChunks: BlobPart[] = [];
  let usingLocal = false;
  let silenceRaf = 0;
  let silenceAudioCtx: AudioContext | null = null;
  let localFinalizing = false;
  let status: SpeechStatus = Ctor || canLocal ? 'idle' : 'unsupported';
  let lastTranscript = '';
  let sawFinal = false;
  let doneFired = false;
  let lastErrorCode: string | undefined;
  let onDoneCb: ((outcome: SpeechSessionOutcome) => void) | undefined;
  let onPartialCb: ((result: SpeechResult) => void) | undefined;
  let onStatusCb: ((status: SpeechStatus) => void) | undefined;
  let sessionGen = 0;
  let localeIndex = 0;
  let locales: string[] = [langHint];
  let langUsed = langHint;
  let retryingLocale = false;
  let engine: 'web-speech' | 'local-whisper' = 'web-speech';

  function setStatus(next: SpeechStatus) {
    status = next;
    onStatusCb?.(next);
  }

  function stopMediaTracks() {
    if (silenceRaf) {
      cancelAnimationFrame(silenceRaf);
      silenceRaf = 0;
    }
    if (silenceAudioCtx) {
      void silenceAudioCtx.close().catch(() => undefined);
      silenceAudioCtx = null;
    }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) track.stop();
      mediaStream = null;
    }
  }

  function watchSilenceToAutoStop(session: number, stream: MediaStream) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      silenceAudioCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let heardSpeech = false;
      let lastLoudAt = performance.now();
      const startedAt = performance.now();
      const LOUD = 0.02;
      const SILENCE_MS = 1400;
      const MAX_MS = 15000;
      const MIN_BEFORE_SILENCE_MS = 600;

      const tick = () => {
        if (session !== sessionGen || !usingLocal || localFinalizing) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const v = ((samples[i] ?? 128) - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (rms >= LOUD) {
          heardSpeech = true;
          lastLoudAt = now;
        }
        const elapsed = now - startedAt;
        const quietLongEnough = heardSpeech && now - lastLoudAt >= SILENCE_MS && elapsed >= MIN_BEFORE_SILENCE_MS;
        const timedOut = elapsed >= MAX_MS;
        if (quietLongEnough || timedOut) {
          logSpeechDiagnostic('local-auto-stop', {
            sessionId: session,
            reason: timedOut ? 'max-duration' : 'silence',
            heardSpeech,
            elapsedMs: Math.round(elapsed),
          });
          setStatus('processing');
          void finalizeLocalRecording(session);
          return;
        }
        silenceRaf = requestAnimationFrame(tick);
      };
      silenceRaf = requestAnimationFrame(tick);
    } catch {
      /* auto-stop is optional — user can still press Stop */
    }
  }

  function finish(session: number, reason: SpeechSessionOutcome['reason'], nextStatus: SpeechStatus) {
    if (session !== sessionGen || doneFired) return;
    doneFired = true;
    status = nextStatus;
    stopMediaTracks();
    mediaRecorder = null;
    recognition = null;
    const outcome: SpeechSessionOutcome = {
      status: nextStatus,
      reason,
      lastTranscript: lastTranscript.trim(),
      errorCode: lastErrorCode,
      langUsed,
      engine,
    };
    const env = speechEnvironmentHints();
    logSpeechDiagnostic('session-end', {
      sessionId: session,
      reason: outcome.reason,
      status: outcome.status,
      errorCode: outcome.errorCode ?? null,
      preferredLang: langHint,
      langUsed: outcome.langUsed ?? null,
      engine: outcome.engine,
      browserReportsOnline: env.browserReportsOnline,
      secureContext: env.secureContext,
      hasTranscript: Boolean(outcome.lastTranscript),
    });
    onDoneCb?.(outcome);
  }

  async function beginLocalRecording(session: number): Promise<void> {
    if (!canLocal) {
      lastErrorCode = 'network';
      finish(session, 'error', 'error');
      return;
    }
    usingLocal = true;
    localFinalizing = false;
    engine = 'local-whisper';
    langUsed = `local-whisper:${uiLang}`;
    recordedChunks = [];
    warmLocalWhisper();

    const mic = await ensureMicAccess(true);
    if (session !== sessionGen) {
      if (mic.ok && mic.stream) for (const track of mic.stream.getTracks()) track.stop();
      return;
    }
    if (!mic.ok) {
      lastErrorCode = mic.reason === 'denied' ? 'not-allowed' : 'audio-capture';
      finish(session, mic.reason === 'denied' ? 'permission-denied' : 'error', mic.reason === 'denied' ? 'permission-denied' : 'error');
      return;
    }

    mediaStream = mic.stream ?? null;
    if (!mediaStream) {
      lastErrorCode = 'audio-capture';
      finish(session, 'error', 'error');
      return;
    }

    const mime = pickRecorderMimeType();
    try {
      mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
    } catch {
      stopMediaTracks();
      lastErrorCode = 'audio-capture';
      finish(session, 'error', 'error');
      return;
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onerror = () => {
      if (session !== sessionGen) return;
      lastErrorCode = 'audio-capture';
      finish(session, 'error', 'error');
    };
    mediaRecorder.start(200);
    setStatus('listening');
    watchSilenceToAutoStop(session, mediaStream);
    logSpeechDiagnostic('local-recording-start', { sessionId: session, mime: mime ?? 'default' });
  }

  async function finalizeLocalRecording(session: number): Promise<void> {
    if (localFinalizing) return;
    localFinalizing = true;
    if (silenceRaf) {
      cancelAnimationFrame(silenceRaf);
      silenceRaf = 0;
    }
    const recorder = mediaRecorder;
    mediaRecorder = null;
    if (!recorder) {
      localFinalizing = false;
      finish(session, 'aborted', 'idle');
      return;
    }

    const blob = await new Promise<Blob>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve(new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.onstop = done;
      try {
        if (recorder.state === 'recording') {
          try {
            recorder.requestData();
          } catch {
            /* optional flush */
          }
          recorder.stop();
        } else {
          done();
        }
      } catch {
        done();
      }
      window.setTimeout(done, 1500);
    });
    stopMediaTracks();

    if (session !== sessionGen) return;
    if (blob.size < 256) {
      lastErrorCode = 'no-speech';
      finish(session, 'no-speech', 'no-speech');
      return;
    }

    setStatus('loading-model');
    try {
      const text = await transcribeAudioBlob(blob, uiLang, (progress) => {
        if (session !== sessionGen) return;
        setStatus(progress.phase === 'loading-model' ? 'loading-model' : 'transcribing');
      });
      if (session !== sessionGen) return;
      lastTranscript = text;
      if (!text) {
        lastErrorCode = 'no-speech';
        finish(session, 'no-speech', 'no-speech');
        return;
      }
      onPartialCb?.({ transcript: text, isFinal: true });
      finish(session, 'final', 'idle');
    } catch (err) {
      logSpeechDiagnostic('local-whisper-failed', {
        sessionId: session,
        message: err instanceof Error ? err.message : 'unknown',
      });
      // A failed model download must not trap later clicks on the on-device path.
      clearPreferLocal();
      lastErrorCode = 'local-whisper-failed';
      finish(session, 'error', 'error');
    }
  }

  function bindRecognition(session: number, lang: string): SpeechRecognitionLike {
    const rec = new Ctor!();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    langUsed = lang;
    engine = 'web-speech';

    rec.onresult = (event) => {
      if (session !== sessionGen || usingLocal) return;
      const { transcript, isFinal } = accumulateTranscript(event);
      if (transcript) lastTranscript = transcript;
      setStatus('processing');
      onPartialCb?.({ transcript: lastTranscript, isFinal });
      if (isFinal) {
        sawFinal = true;
        try {
          recognition?.stop();
        } catch {
          /* ignore */
        }
      }
    };
    rec.onnomatch = () => {
      if (session !== sessionGen) return;
      lastErrorCode = 'no-match';
    };
    rec.onerror = (event) => {
      if (session !== sessionGen || usingLocal) return;
      const code = event.error ?? 'unknown';
      if (code === 'aborted' && (retryingLocale || sawFinal)) return;
      lastErrorCode = code;
      logSpeechDiagnostic('engine-error', {
        sessionId: session,
        errorCode: code,
        preferredLang: langHint,
        langUsed: lang,
        localeFallbackEligible: isLocaleFallbackEligible(code),
      });
      const classified = classifySpeechError(code);
      if (classified.status !== 'idle') setStatus(classified.status);
    };
    rec.onend = () => {
      if (session !== sessionGen || usingLocal) return;

      if (
        isLocaleFallbackEligible(lastErrorCode) &&
        localeIndex + 1 < locales.length &&
        !sawFinal &&
        !lastTranscript.trim()
      ) {
        const failedCode = lastErrorCode;
        localeIndex += 1;
        const nextLang = locales[localeIndex]!;
        logSpeechDiagnostic('locale-fallback', {
          sessionId: session,
          from: lang,
          to: nextLang,
          because: failedCode,
        });
        retryingLocale = true;
        lastErrorCode = undefined;
        setStatus('listening');
        void delay(280).then(() => {
          if (session !== sessionGen || usingLocal) return;
          try {
            recognition = bindRecognition(session, nextLang);
            recognition.start();
            retryingLocale = false;
          } catch {
            retryingLocale = false;
            lastErrorCode = 'start-failed';
            finish(session, 'error', 'error');
          }
        });
        return;
      }

      if (sawFinal) {
        finish(session, 'final', 'idle');
        return;
      }
      if (lastErrorCode === 'network' || lastErrorCode === 'language-not-supported' || lastErrorCode === 'service-not-allowed') {
        logSpeechDiagnostic('cloud-speech-failed', {
          sessionId: session,
          because: lastErrorCode,
          tried: locales.slice(0, localeIndex + 1),
        });
        const classified = classifySpeechError(lastErrorCode);
        finish(session, classified.reason, classified.status);
        return;
      }
      const classified = classifySpeechError(lastErrorCode);
      if (lastErrorCode) {
        finish(session, classified.reason, classified.status);
        return;
      }
      if (lastTranscript.trim()) {
        finish(session, 'ended-with-transcript', 'idle');
        return;
      }
      finish(session, 'no-speech', 'no-speech');
    };
    return rec;
  }

  const adapter: SpeechAdapter = {
    get supported() {
      return Ctor != null;
    },
    get lang() {
      return langUsed;
    },
    get status() {
      return status;
    },
    set status(next: SpeechStatus) {
      status = next;
    },
    async start(onPartial, onDone, onStatus) {
      if (!Ctor && !canLocal) {
        status = 'unsupported';
        throw new Error('speech-unsupported');
      }
      adapter.cancel();
      const mySession = ++sessionGen;
      // At most two Web Speech locale attempts. A failure ends the session; it does not start Whisper.
      locales = speechLocaleFallbackChain(langHint).slice(0, 2);
      localeIndex = 0;
      lastTranscript = '';
      sawFinal = false;
      doneFired = false;
      lastErrorCode = undefined;
      retryingLocale = false;
      usingLocal = false;
      recordedChunks = [];
      onDoneCb = onDone;
      onPartialCb = onPartial;
      onStatusCb = onStatus;
      setStatus('listening');

      // Web Speech only. whisper-tiny is not a verified Arabic, Lebanese, or English recognizer.
      clearPreferLocal();
      if (!Ctor) {
        status = 'unsupported';
        throw new Error('speech-unsupported');
      }

      const env = speechEnvironmentHints();
      logSpeechDiagnostic('session-start', {
        sessionId: mySession,
        preferredLang: langHint,
        attemptLang: locales[0],
        localeChain: locales,
        secureContext: env.secureContext,
        browserReportsOnline: env.browserReportsOnline,
      });

      recognition = bindRecognition(mySession, locales[0]!);
      try {
        recognition.start();
      } catch {
        recognition = null;
        lastErrorCode = 'start-failed';
        finish(mySession, 'error', 'error');
      }
    },
    stop() {
      if (retryingLocale) return;
      if (usingLocal || mediaRecorder) {
        if (localFinalizing) return;
        const session = sessionGen;
        setStatus('processing');
        void finalizeLocalRecording(session);
        return;
      }
      if (!recognition) {
        if (!doneFired && (status === 'listening' || status === 'processing' || status === 'loading-model' || status === 'transcribing')) {
          lastErrorCode = 'aborted';
          finish(sessionGen, 'aborted', 'idle');
          sessionGen += 1;
        }
        return;
      }
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    },
    cancel() {
      const dying = recognition;
      recognition = null;
      try {
        dying?.abort();
      } catch {
        /* ignore */
      }
      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      } catch {
        /* ignore */
      }
      mediaRecorder = null;
      stopMediaTracks();
      if (!doneFired && onDoneCb) {
        finish(sessionGen, 'aborted', 'idle');
      } else if (status !== 'idle' && status !== 'unsupported') {
        status = 'idle';
      }
      sessionGen += 1;
    },
  };

  // Not called. whisper-tiny failed a real microphone test and must not fill the composer.
  void beginLocalRecording;
  return adapter;
}
