/**
 * On-device speech-to-text via Whisper (transformers.js).
 * Audio never leaves the browser for a paid transcription API — weights run locally after one model download.
 */

import { useLocalOrt } from './ortAssets';

export type LocalWhisperProgress = {
  phase: 'loading-model' | 'transcribing';
  /** 0–1 when the library reports download progress; otherwise null. */
  progress: number | null;
};

type AsrPipeline = (
  input: Float32Array | string | URL | Blob,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | { text?: string }[]>;

let pipelinePromise: Promise<AsrPipeline> | null = null;

const MODEL_ID = 'Xenova/whisper-tiny';
const TARGET_RATE = 16000;

function whisperLanguage(uiLang: 'ar' | 'en'): string {
  return uiLang === 'ar' ? 'arabic' : 'english';
}

export function resetLocalWhisperForTests(): void {
  pipelinePromise = null;
}

async function loadPipeline(onProgress?: (progress: LocalWhisperProgress) => void): Promise<AsrPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      onProgress?.({ phase: 'loading-model', progress: null });
      const { pipeline, env } = await import('@huggingface/transformers');
      // Prefer CDN/cache; never phone home with audio — only model weights.
      env.allowLocalModels = false;
      useLocalOrt(env);
      const asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'q8',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (item: any) => {
          if (item?.status === 'progress' && typeof item.progress === 'number') {
            onProgress?.({ phase: 'loading-model', progress: Math.min(1, Math.max(0, item.progress / 100)) });
          }
        },
      } as Record<string, unknown>);
      return asr as unknown as AsrPipeline;
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

/** Warm the model in the background so Stop → transcript is faster. */
export function warmLocalWhisper(): void {
  if (typeof window === 'undefined') return;
  void loadPipeline().catch(() => undefined);
}

/** Decode a recorded Blob to mono Float32 PCM at 16 kHz for Whisper. */
export async function decodeAudioBlobToFloat32(blob: Blob, targetSampleRate = TARGET_RATE): Promise<Float32Array> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const buffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    const length = decoded.length;
    const mixed = new Float32Array(length);
    const channels = decoded.numberOfChannels;
    for (let ch = 0; ch < channels; ch += 1) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        mixed[i] = (mixed[i] ?? 0) + (data[i] ?? 0) / channels;
      }
    }
    if (decoded.sampleRate === targetSampleRate) {
      return mixed;
    }
    const ratio = decoded.sampleRate / targetSampleRate;
    const outLen = Math.max(1, Math.floor(mixed.length / ratio));
    const resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(mixed.length - 1, i0 + 1);
      const t = src - i0;
      resampled[i] = (mixed[i0] ?? 0) * (1 - t) + (mixed[i1] ?? 0) * t;
    }
    return resampled;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export async function transcribeAudioBlob(
  blob: Blob,
  uiLang: 'ar' | 'en',
  onProgress?: (progress: LocalWhisperProgress) => void,
): Promise<string> {
  const asr = await loadPipeline(onProgress);
  onProgress?.({ phase: 'transcribing', progress: null });
  const audio = await decodeAudioBlobToFloat32(blob);
  if (audio.length < TARGET_RATE * 0.15) {
    // < ~0.15s — treat as silence
    return '';
  }
  // sampling_rate is required: without it Whisper mis-reads the PCM and often returns empty text.
  const result = await asr(audio, {
    language: whisperLanguage(uiLang),
    task: 'transcribe',
    return_timestamps: false,
    sampling_rate: TARGET_RATE,
  });
  const row = Array.isArray(result) ? result[0] : result;
  return (row?.text ?? '').trim();
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function localSpeechSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
