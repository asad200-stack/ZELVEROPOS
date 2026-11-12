/**
 * Bounded, in-session conversation memory for Zelvero AI.
 *
 * It lives only in the open panel (never in Firestore, never sent anywhere) and is keyed by the
 * caller to one tenant + user. It stores what the planner needs for follow-ups: the last data
 * request, the last comparison, products named in the last answer, and any open clarification.
 */
import type { ReadRequest } from '../readIntent';
import type { AiLang } from '../engine';
import type { InsightSpec } from './insights';

export const MEMORY_MAX_TURNS = 12;
export const MEMORY_MAX_TEXT = 400;
export const MEMORY_MAX_PRODUCTS = 10;

export interface PeriodSpec {
  from: string;
  to: string;
  label: string;
}

export type CompareMetric = 'sales' | 'profit';

export interface CompareSpec {
  metric: CompareMetric;
  current: PeriodSpec;
  previous: PeriodSpec;
  explain: boolean;
  /** Adds the product-level breakdown ("show me the details"). */
  detail: boolean;
}

export type ClarifyTopic = 'sales' | 'profit' | 'stock' | 'debts' | 'cashbox' | 'bestSellers';

export interface PendingClarify {
  /** What the question still needs. */
  need: 'topic';
  /** Original question, kept so the answer can reuse its period words. */
  question: string;
  options: ClarifyTopic[];
  /** Comparison the user asked for, waiting on a metric. */
  compare: boolean;
}

export interface MemoryTurn {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface CopilotMemory {
  v: 1;
  turns: MemoryTurn[];
  lang: AiLang | null;
  lastRead: ReadRequest | null;
  lastCompare: CompareSpec | null;
  lastInsight: InsightSpec | null;
  lastKind: 'none' | 'read' | 'compare' | 'insight' | 'knowledge' | 'clarify' | 'refuse' | 'action';
  /** Product names in the order the last answer listed them (for "the first one", "هيدا", "it"). */
  products: string[];
  pending: PendingClarify | null;
}

export function emptyMemory(): CopilotMemory {
  return { v: 1, turns: [], lang: null, lastRead: null, lastCompare: null, lastInsight: null, lastKind: 'none', products: [], pending: null };
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > MEMORY_MAX_TEXT ? `${t.slice(0, MEMORY_MAX_TEXT - 1)}…` : t;
}

export function rememberTurn(memory: CopilotMemory, role: MemoryTurn['role'], text: string, at = Date.now()): CopilotMemory {
  const turns = [...memory.turns, { role, text: clip(text), at }].slice(-MEMORY_MAX_TURNS);
  return { ...memory, turns };
}

/** Product names quoted «like this» in a grounded answer, in order, de-duplicated, capped. */
export function productsListed(answer: string): string[] {
  const names: string[] = [];
  for (const match of answer.matchAll(/«([^»\n]{1,80})»/g)) {
    const name = match[1]!.trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= MEMORY_MAX_PRODUCTS) break;
  }
  return names;
}

export function rememberRead(memory: CopilotMemory, read: ReadRequest, answerText: string): CopilotMemory {
  const listed = productsListed(answerText);
  return {
    ...memory,
    lang: read.lang,
    lastRead: read,
    lastCompare: null,
    lastKind: 'read',
    products: listed.length > 0 ? listed : memory.products,
    pending: null,
  };
}

export function rememberCompare(memory: CopilotMemory, spec: CompareSpec, lang: AiLang, answerText: string): CopilotMemory {
  const listed = productsListed(answerText);
  return { ...memory, lang, lastCompare: spec, lastKind: 'compare', products: listed.length > 0 ? listed : memory.products, pending: null };
}

export function rememberInsight(memory: CopilotMemory, spec: InsightSpec, lang: AiLang, answerText: string): CopilotMemory {
  const listed = productsListed(answerText);
  return { ...memory, lang, lastInsight: spec, lastKind: 'insight', products: listed.length > 0 ? listed : memory.products, pending: null };
}

export function rememberClarify(memory: CopilotMemory, pending: PendingClarify): CopilotMemory {
  return { ...memory, lastKind: 'clarify', pending };
}

export function rememberOther(memory: CopilotMemory, kind: 'knowledge' | 'refuse' | 'action'): CopilotMemory {
  // A knowledge answer or refusal does not erase the data context: "and yesterday?" still works after a how-to.
  return { ...memory, lastKind: kind, pending: null };
}

/** Memory is per tenant + user. Switching either starts clean, so no context crosses stores. */
export function memoryScope(tenantId: string | null, uid: string): string {
  return `${tenantId ?? 'platform'}:${uid}`;
}
