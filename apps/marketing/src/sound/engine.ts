import { STORAGE } from '../constants';

export type SoundKind = 'click' | 'nav' | 'primary' | 'toggle' | 'aiOpen' | 'aiSend' | 'aiResponse' | 'success' | 'demo';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE.sound) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readEnabled();
let ctx: AudioContext | null = null;
let playCount = 0;

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE.sound, next ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function soundPlayCount(): number {
  return playCount;
}

export function resetSoundForTests(): void {
  enabled = true;
  playCount = 0;
  ctx = null;
}

const TONE: Record<SoundKind, { freq: number; dur: number; vol: number; type: OscillatorType; to?: number }> = {
  nav: { freq: 720, dur: 0.032, vol: 0.022, type: 'sine' },
  click: { freq: 880, dur: 0.04, vol: 0.03, type: 'triangle' },
  primary: { freq: 920, dur: 0.045, vol: 0.032, type: 'triangle', to: 1180 },
  toggle: { freq: 560, dur: 0.04, vol: 0.024, type: 'sine' },
  aiOpen: { freq: 640, dur: 0.07, vol: 0.028, type: 'sine', to: 980 },
  aiSend: { freq: 780, dur: 0.035, vol: 0.024, type: 'triangle' },
  aiResponse: { freq: 520, dur: 0.06, vol: 0.022, type: 'sine', to: 740 },
  success: { freq: 980, dur: 0.09, vol: 0.034, type: 'sine', to: 1480 },
  demo: { freq: 700, dur: 0.05, vol: 0.026, type: 'sine', to: 860 },
};

/** Short, quiet UI tones. Never autoplays. */
export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  playCount += 1;
  const audio = context();
  if (!audio) return;
  void audio.resume();
  const now = audio.currentTime;
  const spec = TONE[kind];
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, now);
  if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to, now + spec.dur);
  gain.gain.setValueAtTime(spec.vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);
  osc.start(now);
  osc.stop(now + spec.dur + 0.02);
}
