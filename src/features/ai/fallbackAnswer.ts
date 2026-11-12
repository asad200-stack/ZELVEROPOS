/**
 * When reviewed-card search misses, resolve the next honest source —
 * never invent features, and never dump a bare "no documented answer".
 */

import { shortGuideAnswer } from './actions/guide';
import { resolveNavigateTarget } from './actions/navigateIntent';
import { AI_FORBIDDEN_ACTIONS } from './actions/allowlist';
import type { AiLang, Answer, AskContext, KnowledgeItem } from './engine';
import {
  isOwnerAllPermissionsQuestion,
  isProductOverviewQuestion,
  looksLikeInternalStub,
  ownerPermissionsText,
  productOverviewText,
  sanitizeUserFacingText,
} from './userFacingAnswer';

function canUseItem(item: KnowledgeItem, ctx: AskContext): boolean {
  if (item.audience === 'public' || item.audience === 'member') return true;
  if (item.audience === 'owner') return ctx.isOwner;
  if (item.audience === 'superAdmin') return ctx.isSuperAdmin;
  if (item.audience === 'permission' && item.permission) return ctx.isOwner || ctx.can(item.permission);
  return false;
}

/** Features Zelvero POS does not have — answer honestly instead of fabricating. */
const UNAVAILABLE_FEATURE =
  /\bloyalty\b|\brewards?\b|\bpoints\s*program\b|\be-?commerce\b|\bonline\s*store\b|\bshopify\b|\bwoocommerce\b|\bwhatsapp\s*(?:bot|shop)\b|\bdelivery\s*app\b|\baccounting\s*(?:export|sync|software)\b|\btax\s*filing\b|\bintegrat(?:e|ion)\s+with\b|برنامج\s*ولاء|نقاط\s*مكافآت|متجر\s*(?:إلكتروني|الكتروني)|شوفاي|ضريبة\s*الدخل/i;

const CAPABILITY_ASK =
  /\bwhat\s+can\s+you\s+(?:do|help)\b|\bwhat\s+do\s+you\s+(?:do|support)\b|\byour\s+capabilities\b|شو\s*(?:فينك|بتقدر|بتعمل|تقدر)|ايش\s*بتقدر|شو\s*تقدر\s*تعمل/i;

const POS_SCOPED =
  /\bpos\b|\bsale\b|\bcart\b|\bproduct\b|\bcustomer\b|\bsupplier\b|\bpurchase\b|\bcash(?:box|ier)?\b|\binvoice\b|\bstock\b|\binventory\b|\bpermission\b|\breport\b|\breturn\b|\brefund\b|\bdebt\b|\bcheckout\b|نقطة\s*البيع|بيع|سلة|منتج|زبون|مورد|شراء|صندوق|فاتورة|مخزون|صلاحية|تقرير|مرتجع|دين|دفع|كاشير|المنتجات|المبيعات|الزبائن/i;

const VAGUE_ONLY = /^(help|مساعدة|ساعدني|؟|\?|hi|hello|مرحبا|هلا)$/i;

const GREETING =
  /^(?:مرحبا|مرحبًا|مرحباً|هلا|أهلين|اهلين|أهلا|اهلا|السلام(?:\s+عليكم)?|صباح الخير|مساء الخير|hi|hello|hey)(?:\s+\S+){0,4}[.!?؟]*$/i;

/** Arabic script in the request means the reply must be Arabic, even if the UI is English. */
export function replyLanguage(text: string, uiLang: 'en' | 'ar'): 'en' | 'ar' {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : uiLang;
}

export function greetingReply(text: string, lang: 'en' | 'ar'): string | null {
  if (!GREETING.test(text.trim())) return null;
  return lang === 'ar'
    ? 'أهلاً. قلي شو بدك: تفتح صفحة، تضيف منتج، أو تسأل عن رقم من المتجر.'
    : 'Hello. Tell me what you need: open a page, add a product, or ask for a store figure.';
}

export function looksLikeUnavailableFeature(question: string): boolean {
  return UNAVAILABLE_FEATURE.test(question.trim());
}

export function softSearchKnowledge(items: KnowledgeItem[], question: string, route: string): KnowledgeItem[] {
  const path = route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
  const tokens = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return [];

  const scored = items
    .filter((item) => item.kind !== 'test' && item.kind !== 'callable' && item.kind !== 'label')
    .map((item) => {
      let score = 0;
      const hay = `${item.title.en} ${item.title.ar} ${item.keywords.join(' ')} ${item.source.symbol}`.toLowerCase();
      for (const token of tokens) {
        if (hay.includes(token)) score += token.length >= 5 ? 3 : 2;
      }
      if (item.route && item.route === path) score += 1;
      if (item.kind === 'document' || item.kind === 'route' || item.kind === 'rule') score += 2;
      return { item, score };
    })
    .filter((row) => row.score >= 5 && !looksLikeInternalStub(row.item.body.en))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  return scored.slice(0, 2).map((row) => row.item);
}

function routeCardForQuestion(items: KnowledgeItem[], question: string, ctx: AskContext): KnowledgeItem | null {
  const target = resolveNavigateTarget(question);
  if (!target) return null;
  const card = items.find((item) => item.kind === 'route' && item.route === target.path);
  if (!card || !canUseItem(card, ctx)) return null;
  return card;
}

function currentRouteCard(items: KnowledgeItem[], ctx: AskContext): KnowledgeItem | null {
  const path = ctx.route.length > 1 && ctx.route.endsWith('/') ? ctx.route.slice(0, -1) : ctx.route;
  const card = items.find((item) => item.kind === 'route' && item.route === path);
  if (!card || !canUseItem(card, ctx)) return null;
  return card;
}

function answered(lang: AiLang, text: string): Answer {
  return { status: 'answered', lang, text, sources: [], executes: false };
}

function unknown(lang: AiLang, text: string): Answer {
  return { status: 'unknown', lang, text, sources: [], executes: false };
}

function capabilityText(lang: AiLang): string {
  if (lang === 'ar') {
    return [
      'فيني ساعدك بهالشي داخل Zelvero POS:',
      '• شرح خطوات الشاشات (منتجات، زبائن، بيع، مرتجع…).',
      '• فتح صفحة مسموحة لك.',
      '• تجهيز إضافة منتج أو تحضير السلة بعد تأكيدك.',
      '• قراءة أرقام المتجر اللي صلاحيتك بتسمح فيها.',
      '',
      'ما بقدر أنفّذ دفع، مرتجع، دين، أو حركة صندوق من الدردشة — هيدا من الشاشة.',
    ].join('\n');
  }
  return [
    'I can help inside Zelvero POS with:',
    '• How-to steps for real screens (products, customers, sales, returns…).',
    '• Opening a page you are allowed to use.',
    '• Preparing a product draft or cart change after you confirm.',
    '• Reading store figures your role can already see.',
    '',
    'I cannot complete checkout, refunds, debt collection, or cashbox moves from chat — those stay on-screen.',
  ].join('\n');
}

function unavailableFeatureText(lang: AiLang): string {
  return lang === 'ar'
    ? 'هالشي مش موجود بهالنظام. قلّي عن شاشة أو عملية من Zelvero POS (منتجات، زبائن، بيع، مشتريات، صندوق…).'
    : 'That feature is not part of this system. Ask about a Zelvero POS screen or workflow (products, customers, sales, purchases, cashbox…).';
}

/** Concrete example questions the rule engine does understand, shown so an unmatched question isn't a dead end. */
function exampleQuestionsText(lang: AiLang): string {
  return lang === 'ar'
    ? 'جرّب مثلاً: "كم المبيعات اليوم؟"، "شو الربح اليوم؟"، "شو المنتجات يلي الكمية فيها قليلة؟"، "في ديون؟"، "قارن مبيعات هالاسبوع مع يلي فات".'
    : 'Try asking: "sales today", "profit today", "which products are low on stock", "any debts", or "compare this week vs last week".';
}

function clarifyText(lang: AiLang): string {
  const base =
    lang === 'ar'
      ? 'ما قدرت افهم سؤالك تمامًا. وضّح شو بدك: شرح خطوات، فتح صفحة، أرقام المتجر، ولا عملية مسموحة (مثل إضافة منتج أو تحضير السلة)؟'
      : "I didn't quite catch that. What do you need: how-to steps, open a page, store figures, or an allowed action (like add product or prepare the cart)?";
  return `${base}\n\n${exampleQuestionsText(lang)}`;
}

function scopedHelpText(lang: AiLang): string {
  const base =
    lang === 'ar'
      ? 'ما قدرت افهم سؤالك هيك. بساعد ضمن Zelvero POS: الشاشات، الصلاحيات، خطوات العمل، والتنقّل، وأرقام المتجر المسموحة.'
      : "I didn't quite catch that. I help with Zelvero POS: screens, permissions, workflows, navigation, and allowed store figures.";
  return `${base}\n\n${exampleQuestionsText(lang)}`;
}

function pageContextText(card: KnowledgeItem, lang: AiLang): string {
  const body = card.body[lang].trim();
  if (lang === 'ar') {
    return `عن هالصفحة:\n${body}\n\nإذا بدك خطوة معيّنة أو فتح نموذج إضافة، قلّي بوضوح.`;
  }
  return `About this screen:\n${body}\n\nIf you need a specific step or an add form opened, say so clearly.`;
}

/**
 * Next-best resolution after a primary knowledge miss.
 * Prefer verified app context over a generic unsupported sentence.
 */
export function resolveKnowledgeMiss(items: KnowledgeItem[], ctx: AskContext, lang: AiLang): Answer {
  const q = ctx.question.trim();

  if (isProductOverviewQuestion(q)) {
    return answered(lang, productOverviewText(lang));
  }
  if (isOwnerAllPermissionsQuestion(q)) {
    return answered(lang, ownerPermissionsText(lang));
  }

  if (CAPABILITY_ASK.test(q)) {
    return answered(lang, capabilityText(lang));
  }

  if (UNAVAILABLE_FEATURE.test(q)) {
    return unknown(lang, unavailableFeatureText(lang));
  }

  // Guide workflows (application implementation) even if card search scored nothing.
  const guide = shortGuideAnswer(q, lang);
  if (guide) {
    return answered(lang, guide);
  }

  const namedRoute = routeCardForQuestion(items, q, ctx);
  if (namedRoute) {
    return answered(lang, sanitizeUserFacingText(namedRoute.body[lang]));
  }

  const soft = softSearchKnowledge(items, q, ctx.route).filter((item) => canUseItem(item, ctx));
  if (soft.length > 0) {
    const preferred =
      soft.find((item) => item.kind === 'document') ??
      soft.find((item) => item.kind === 'rule') ??
      soft.find((item) => item.kind === 'route') ??
      soft[0]!;
    return answered(lang, sanitizeUserFacingText(preferred.body[lang]));
  }

  if (VAGUE_ONLY.test(q)) {
    return unknown(lang, clarifyText(lang));
  }

  if (POS_SCOPED.test(q)) {
    const here = currentRouteCard(items, ctx);
    if (here && /this\s+page|this\s+screen|هالصفحة|هاي الصفحة|هيدي/i.test(q)) {
      return answered(lang, pageContextText(here, lang));
    }
    if (AI_FORBIDDEN_ACTIONS.some((id) => q.toLowerCase().includes(id.toLowerCase()))) {
      return unknown(
        lang,
        lang === 'ar'
          ? 'هالعملية المالية بتتم من الشاشة فقط، مش من الدردشة.'
          : 'That financial step is done on-screen only, not from this chat.',
      );
    }
    return unknown(lang, clarifyText(lang));
  }

  return unknown(lang, scopedHelpText(lang));
}

/** True when the reply is the old generic miss that must not ship. */
export function isGenericUnsupportedAnswer(text: string): boolean {
  return (
    /I don't have a (?:verified|documented) answer/i.test(text) ||
    /ما عندي جواب موثّق/i.test(text)
  );
}
