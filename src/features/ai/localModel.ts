/**
 * Optional local llama.cpp server. Loopback HTTP only.
 * No API key, no OpenAI/Gemini/Anthropic host, and no Firebase credentials.
 *
 * Local weights: Qwen3-4B-Instruct-2507 Q4_K_M (Apache-2.0), CPU only.
 * The server is started with a short context so the 16 GB machine stays usable.
 * One generation at a time. If this server is down, the panel keeps the reviewed note.
 */
import type { AiLang } from './engine';

export const LOCAL_MODEL_MAX_TOKENS = 280;
export const LOCAL_MODEL_TIMEOUT_MS = 90_000;

const SYSTEM = [
  'You are Zelvero AI, a local assistant for the Zelvero POS.',
  'Rephrase only the verified notes in the requested language (Arabic or English).',
  'Do not add screens, buttons, prices, permissions, or steps that are not in the notes.',
  'Do not claim a feature is deployed to production.',
  'Do not call tools or suggest that you changed any data.',
  'If the notes are empty, say you do not know.',
].join(' ');

const LIVE_SYSTEM = [
  'You explain a read-only snapshot from the signed-in Zelvero store.',
  'Use only numbers, names, dates, and currencies that appear in the snapshot.',
  'Do not name a product that is not written in the snapshot.',
  'Do not invent a figure when the snapshot says the data was not read, is incomplete, or says nothing was recorded.',
  'If nothing was recorded, say that in words. Do not replace it with a zero.',
  'Keep USD and LBP separate. Never add them into one total.',
  'Do not claim you changed sales, stock, debts, or the cash drawer.',
  'Reply in the requested language.',
].join(' ');

export function localModelUrl(input: string | undefined | null): string | null {
  const raw = input == null || input.trim() === '' ? 'http://127.0.0.1:8081' : input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

export function modelRequest(question: string, verified: string, lang: AiLang, kind: 'notes' | 'live' = 'notes') {
  return {
    model: 'local',
    temperature: 0.2,
    max_tokens: LOCAL_MODEL_MAX_TOKENS,
    messages: [
      { role: 'system' as const, content: kind === 'live' ? LIVE_SYSTEM : SYSTEM },
      {
        role: 'user' as const,
        content: `Language: ${lang === 'ar' ? 'Arabic' : 'English'}\nQuestion: ${question}\n${kind === 'live' ? 'Read-only snapshot' : 'Verified notes'}:\n${verified}`,
      },
    ],
  };
}

export async function probeLocalModel(origin: string): Promise<boolean> {
  if (localModelUrl(origin) !== origin) return false;
  try {
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

export function visibleModelWording(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export async function phraseWithLocalModel(
  origin: string,
  question: string,
  verified: string,
  lang: AiLang,
  timeoutMs = LOCAL_MODEL_TIMEOUT_MS,
  kind: 'notes' | 'live' = 'notes',
): Promise<string> {
  if (localModelUrl(origin) !== origin) throw new Error('model-url');
  const response = await fetch(`${origin}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(modelRequest(question, verified, lang, kind)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('model-http');
  const payload = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('model-empty');
  const wording = visibleModelWording(content);
  if (wording === '') throw new Error('model-empty');
  return wording;
}
