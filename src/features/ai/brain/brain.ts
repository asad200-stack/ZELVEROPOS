/**
 * Zelvero AI "brain": the in-house conversational layer on top of the existing planner.
 * Fully local rules, no external model or paid API. Every figure is read from the signed-in
 * store through the server-enforced source and checked against the person's permissions.
 */
import type { AiLang } from '../engine';
import type { ReadRequest } from '../readIntent';
import type { ReadSession } from '../readSnapshot';
import type { InsightSource } from '../serverReadSource';
import type { PeriodSpec } from '../copilot/memory';
import { advice } from './advice';
import { briefing, type BrainAnswer } from './briefing';
import type { BrainIntent } from './intents';
import { cashAnswer, debtsAnswer, metricAnswer } from './metrics';
import { expiryAnswer, profitAnswer, rankAnswer, stockItemAnswer, stockListAnswer } from './renderers';

export { compareAnswer } from './renderers';

export type { BrainAnswer } from './briefing';
export { detectBrainIntent, arabiziRouting, type BrainIntent } from './intents';
export { smallTalkReply, capabilitiesText } from './smallTalk';
export { presentAnswer } from './present';
export { replyLang } from './lang';

export async function answerBrainIntent(
  intent: Extract<BrainIntent, { kind: 'briefing' | 'advice' | 'metric' | 'stock' }>,
  session: ReadSession,
  src: InsightSource,
  lang: AiLang,
  now: Date,
): Promise<BrainAnswer> {
  if (intent.kind === 'briefing') return briefing(session, src, lang, now, intent.period);
  if (intent.kind === 'advice') return advice(session, src, lang, now);
  if (intent.kind === 'stock') return stockItemAnswer(intent.product, intent.qty, session, src, lang);
  return metricAnswer(intent.metric, intent.period, session, src, lang, now);
}

/**
 * A friendlier rendering for the simplest planner reads (plain sales, cash drawer, debts).
 * Returns null for everything else, which then shows the canonical answer after presentAnswer.
 */
export async function renderRead(request: ReadRequest, session: ReadSession, src: InsightSource, lang: AiLang, now: Date): Promise<BrainAnswer | null> {
  const only = request.topics.length === 1 ? request.topics[0] : null;
  if (only === 'sales' && request.profitAnswer === 'off' && !request.includeProfit && !request.range.limited) {
    const period: PeriodSpec = { from: request.range.from, to: request.range.to, label: request.range.label };
    return metricAnswer('sales', period, session, src, lang, now);
  }
  if (only === 'sales' && request.profitAnswer !== 'off' && !request.range.limited) return profitAnswer(request, session, src, lang);
  if (only === 'cashbox') return cashAnswer(session, src, lang);
  if (only === 'debts') return debtsAnswer(session, src, lang);
  if (only === 'stockItem' && request.stockName) return stockItemAnswer(request.stockName, request.stockQty, session, src, lang);
  if (only === 'outOfStock') return stockListAnswer('out', request, session, src, lang);
  if (only === 'lowStock') return stockListAnswer('low', request, session, src, lang);
  if (only === 'expiry') return expiryAnswer(session, src, lang, now);
  if (only === 'productRank') return rankAnswer(request, session, src, lang);
  return null;
}

/** Follow-up suggestions for an answer the brain did not write itself. */
export function suggestionsFor(kind: 'read' | 'compare' | 'insight' | 'knowledge', lang: AiLang): string[] {
  if (lang === 'ar') {
    if (kind === 'compare') return ['ليش؟', 'فرجيني التفاصيل'];
    if (kind === 'insight') return ['فرجيني الكل', 'كيف الشغل اليوم؟'];
    if (kind === 'knowledge') return ['كيف الشغل اليوم؟', 'شو فيك تعمل؟'];
    return ['كيف الشغل اليوم؟', 'شو لازم اطلب؟'];
  }
  if (kind === 'compare') return ['Why?', 'Show details'];
  if (kind === 'insight') return ['Show all', 'How is business today?'];
  if (kind === 'knowledge') return ['How is business today?', 'What can you do?'];
  return ['How is business today?', 'What should I reorder?'];
}

/** Knowledge cards written for reviewers (internal workflow notes) are not shown as answers. */
export function looksInternal(text: string): boolean {
  return /^I didn't quite catch that|^ما قدرت افهم سؤالك|cannot call it\.|لا يستطيع استدعاءه|workflow :|سير عمل .{0,40} :|\broute \/|belongs to route|The English label for|English label is/i.test(text);
}

export function missReply(lang: AiLang): BrainAnswer {
  return {
    text: lang === 'ar'
      ? 'ما فهمت عليك منيح. فيك تسألني عن الشغل، المبيعات، الربح، البضاعة، الديون، أو كيف تعمل شي بالنظام. جرّب مثلاً:'
      : "I didn't quite get that. Ask me about business, sales, profit, stock, debts, or how to do something in the POS. For example:",
    suggestions: lang === 'ar' ? ['كيف الشغل اليوم؟', 'شو لازم اطلب؟', 'كيف بعمل مرتجع؟'] : ['How is business today?', 'What should I reorder?', 'How do I make a return?'],
  };
}
