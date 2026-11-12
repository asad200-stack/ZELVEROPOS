/**
 * Optional tool selection by the local model (llama.cpp on 127.0.0.1) for data questions the rules miss.
 *
 * The model only picks ONE read-only tool. Its reply must parse as a strict schema (no tenant/store
 * fields, no write tools) or it is ignored. It never produces figures: the chosen tool reads the
 * signed-in store through the same permission-checked code as every other answer.
 */
import type { AiLang } from '../engine';
import { localModelUrl } from '../localModel';
import { isProcedureQuestion } from '../readIntent';
import type { CopilotMemory } from './memory';
import type { TurnPlan } from './orchestrator';
import { compareCallToSpec, parseModelToolCall, plannerRequest, storeReadToRequest } from './tools';

export const MODEL_PLANNER_TIMEOUT_MS = 20_000;

const DATA_NOUN =
  /sales|sold|revenue|profit|margin|stock|inventory|product|item|cash|drawer|debt|owe|customer|expense|return|order|selling|مبيع|بعنا|انباع|ربح|أرباح|مخزون|بضاعة|منتج|غرض|صندوق|كاش|دين|ديون|زبون|زباين|مصروف|مصاريف|مرتجع|طلبية/i;

/** Only data-sounding questions that are not how-to questions go to the model planner. */
export function worthModelPlanning(routingText: string): boolean {
  return DATA_NOUN.test(routingText) && !isProcedureQuestion(routingText) && routingText.length <= 600;
}

function recentContext(memory: CopilotMemory): string {
  return memory.turns
    .filter((t) => t.role === 'user')
    .slice(-3)
    .map((t) => t.text)
    .join(' | ');
}

export async function planWithLocalModel(
  origin: string,
  routingText: string,
  memory: CopilotMemory,
  lang: AiLang,
  now: Date,
  fetcher: typeof fetch = fetch,
  timeoutMs = MODEL_PLANNER_TIMEOUT_MS,
): Promise<TurnPlan | null> {
  if (localModelUrl(origin) !== origin) return null;
  if (!worthModelPlanning(routingText)) return null;
  let content: unknown;
  try {
    const response = await fetcher(`${origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(plannerRequest(routingText, recentContext(memory))),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    content = payload.choices?.[0]?.message?.content;
  } catch {
    return null;
  }
  if (typeof content !== 'string') return null;
  const call = parseModelToolCall(content);
  if (!call) return null;
  if (call.tool === 'store_read') {
    return { kind: 'read', request: storeReadToRequest(call, lang, now), lang, followUp: false, reason: 'model-selected' };
  }
  return { kind: 'compare', spec: compareCallToSpec(call, now), lang, followUp: false, reason: 'model-selected' };
}
