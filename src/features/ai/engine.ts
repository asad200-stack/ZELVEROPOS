/**
 * Zelvero AI answers from reviewed local-source cards.
 * Executable operator actions live in `actions/` behind an explicit allowlist
 * (navigation, product draft/create, cart prep). Financial settlement stays forbidden.
 */
import { AI_TOOLS as ACTION_ALLOWLIST } from './actions/allowlist';
import {
  financeCapabilityRefusalText,
  isFinancialCapabilityQuestion,
} from './actions/financeGuard';
import {
  isGenericUnsupportedAnswer,
  looksLikeUnavailableFeature,
  resolveKnowledgeMiss,
} from './fallbackAnswer';
import { isProcedureQuestion } from './intentHints';
import {
  isOwnerAllPermissionsQuestion,
  isProductOverviewQuestion,
  isSubUserSelfGrantAiQuestion,
  looksLikeInternalStub,
  ownerPermissionsText,
  productOverviewText,
  sanitizeUserFacingText,
  subUserSelfGrantAiText,
} from './userFacingAnswer';

export type AiLang = 'en' | 'ar';

export interface KnowledgeItem {
  id: string;
  kind: 'route' | 'label' | 'permission' | 'callable' | 'test' | 'document' | 'rule';
  title: { en: string; ar: string };
  body: { en: string; ar: string };
  keywords: string[];
  route: string | null;
  permission: string | null;
  audience: 'public' | 'member' | 'permission' | 'owner' | 'superAdmin';
  callable: string | null;
  executes: false;
  valid: boolean;
  source: {
    path: string;
    symbol: string;
    startLine: number;
    endLine: number;
    sha256: string;
    anchors: { path: string; startLine: number; endLine: number }[];
  };
  release: {
    appVersion: string;
    releaseVersion: string;
    channel: 'local-working-tree';
    productionVerified: false;
  };
}

export interface KnowledgeDraft {
  items: KnowledgeItem[];
}

export interface KnowledgeReview {
  channel: string;
  productionVerified: boolean;
  items: { id: string; sourceHash: string }[];
}

export interface AskContext {
  question: string;
  lang: AiLang;
  route: string;
  isOwner: boolean;
  isSuperAdmin: boolean;
  can: (permission: string) => boolean;
}

export interface AnswerSource {
  id: string;
  path: string;
  symbol: string;
  startLine: number;
  endLine: number;
}

export interface Answer {
  status: 'answered' | 'unknown';
  lang: AiLang;
  text: string;
  sources: AnswerSource[];
  executes: false;
}

/** Explicit allowlist of conversational operator capabilities (see actions/allowlist.ts). */
export const AI_TOOLS = ACTION_ALLOWLIST;

const STOP = new Set(
  'the and for with from this that local source only not how do does did what when where which who why can you your our into onto about please just show tell me my is are was were a an to of in on or if it we i page screen now complete change submit delete move adjust make run هنا شو كيف ما هل في من على ان أن هذا هذه الى إلى يا عن او أو بدي بدّي لو لا وين هيدا هيدي هاي'.split(
    /\s+/,
  ),
);

const PAGE_PHRASES = ['this page', 'this screen', 'what can i do here', 'how does this work', 'هذه الصفحة', 'هالصفحة', 'هاي الصفحة', 'هيدي الصفحة', 'هيدي الشاشة', 'شو هالصفحة'];

interface Reviewable {
  id: string;
  valid: boolean;
  executes: boolean;
  release: { channel: string; productionVerified: boolean };
  source: { sha256: string };
}

export function publishReviewed<T extends Reviewable>(draft: { items: T[] }, review: KnowledgeReview): T[] {
  if (review.channel !== 'local-working-tree' || review.productionVerified !== false) return [];
  const approved = new Map(review.items.map((item) => [item.id, item.sourceHash]));
  return draft.items.filter(
    (item) =>
      item.valid === true &&
      item.executes === false &&
      item.release.channel === 'local-working-tree' &&
      item.release.productionVerified === false &&
      approved.get(item.id) === item.source.sha256,
  );
}

export function answerLanguage(question: string, uiLang: AiLang): AiLang {
  const arabic = /[\u0600-\u06FF]/.test(question);
  const latin = /[A-Za-z]/.test(question);
  if (arabic && !latin) return 'ar';
  if (latin && !arabic) return 'en';
  return uiLang;
}

export function conversationStorageKey(tenantId: string | null, uid: string): string {
  return tenantId ? `zelvero.ai.v1.tenant.${tenantId}.${uid}` : `zelvero.ai.v1.platform.${uid}`;
}

export function shouldConsultModel(answer: Answer): boolean {
  return answer.status === 'answered' && answer.sources.length > 0;
}

function tokensOf(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOP.has(token));
}

function arabicStem(word: string): string {
  const bare = word.startsWith('ال') && word.length > 4 ? word.slice(2) : word;
  return bare.replace(/(?:ون|ين|ات|ة|ه)$/u, '');
}

function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const a = arabicStem(left);
  const b = arabicStem(right);
  return a.length >= 4 && a === b && /[\u0600-\u06FF]/.test(a);
}

function keywordHit(token: string, keyword: string): number {
  if (keyword === token) return token.length >= 4 ? 4 : 2;
  if (sameWord(token, keyword)) return 4;
  if (token.length >= 4 && keyword.includes(token)) return 2;
  const bare = keyword.startsWith('ال') ? keyword.slice(2) : keyword;
  if (bare.length >= 3 && /[\u0600-\u06FF]/.test(bare) && token.includes(bare)) return 3;
  return 0;
}

/** A keyword from a long sentence is not enough. The token has to name the card. */
function tokenNames(item: KnowledgeItem, token: string): boolean {
  const fields = [item.source.symbol];
  if (item.title.en.length <= 48) fields.push(item.title.en);
  if (item.title.ar.length <= 48) fields.push(item.title.ar);
  return fields.some((field) =>
    field
      .replace(/([a-z\u0600-\u06FF])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => sameWord(word, token)),
  );
}

function scoreItem(item: KnowledgeItem, tokens: string[], route: string, workflow: boolean): number {
  let score = 0;
  let namedHits = 0;
  for (const token of tokens) {
    if (!tokenNames(item, token)) continue;
    namedHits += 1;
    for (const keyword of item.keywords) score += keywordHit(token, keyword);
  }
  // How-to questions that already name a workflow document may also score domain nouns from its keywords
  // (stock/cash/debt in a return explanation) without promoting unrelated menu labels.
  if (workflow && item.kind === 'document' && namedHits > 0) {
    for (const token of tokens) {
      if (tokenNames(item, token)) continue;
      for (const keyword of item.keywords) {
        const hit = keywordHit(token, keyword);
        if (hit) score += Math.min(hit, 2);
      }
    }
    score += 6;
  }
  if (item.route && item.route === route) score += 2;
  return score;
}

/** Keep customer-return docs from winning debt-payment or supplier-return how-tos. */
function workflowDocPenalty(item: KnowledgeItem, question: string): number {
  if (item.id !== 'document:pos-return-workflow') return 0;
  if (/supplier|مورد|purchase return|مرتجع(?:\s*ال)?مورد/i.test(question)) return 100;
  const aboutCustomerReturn = /\breturns?\b|\brefund\b|مرتجع|ارجاع/i.test(question);
  if (aboutCustomerReturn) return 0;
  if (/\bdebt\b|\bcredit\b|دين|مديون|payment|استلام/i.test(question)) return 100;
  return 0;
}

function isPageQuestion(question: string): boolean {
  const text = question.trim().toLowerCase();
  return PAGE_PHRASES.some((phrase) => text.includes(phrase));
}

function isPermissionTopic(question: string): boolean {
  return (
    /\bpermissions?\b|\bwho\s+can\b|\bwhich\s+permission\b|\brequired\s+to\b|صلاح(?:ية|يات)|مين\s*(?:بيقدر|يقدر|عنده)|من\s*يقدر/i.test(
      question,
    ) || isOwnerAllPermissionsQuestion(question)
  );
}

function kindEligible(item: KnowledgeItem, question: string, _workflow: boolean, permissionTopic: boolean): boolean {
  if (item.kind === 'test') return wantsTechnicalSources(question);
  if (item.kind === 'callable') {
    return /\bcallable|cloud\s*function|function\s+named|دالة|استدعاء/i.test(question) || wantsTechnicalSources(question);
  }
  if (item.kind === 'label') {
    if (isProductOverviewQuestion(question)) return false;
    if (permissionTopic && /perm\.|permission|صلاح/i.test(item.id + item.title.en)) return true;
    if (/\blabel\b|\bbutton\b|زر|اسم\s*(?:ال)?زر/i.test(question)) return true;
    // Labels may answer named controls (Expense, Checkout) but need a high relevance floor.
    return true;
  }
  if (item.kind === 'permission') return permissionTopic || /\bcan[A-Z]|صلاح/i.test(question);
  return true;
}

/** Minimum score by kind — labels/callables need a much stronger match. */
function relevanceFloor(kind: KnowledgeItem['kind'], workflow: boolean, permissionTopic: boolean): number {
  if (kind === 'document' || kind === 'rule') return workflow || permissionTopic ? 3 : 4;
  if (kind === 'route') return 4;
  if (kind === 'permission') return permissionTopic ? 3 : 6;
  if (kind === 'label') return 10;
  if (kind === 'callable' || kind === 'test') return 12;
  return 6;
}

function kindRankFor(_question: string, workflow: boolean, permissionTopic: boolean): Record<KnowledgeItem['kind'], number> {
  // Prefer verified workflows and rules over implementation metadata.
  const rank: Record<KnowledgeItem['kind'], number> = {
    document: 0,
    rule: 1,
    route: 2,
    permission: 3,
    label: 4,
    callable: 5,
    test: 6,
  };
  if (permissionTopic) {
    rank.rule = 0;
    rank.permission = 1;
    rank.document = 2;
    rank.route = 3;
  } else if (workflow) {
    rank.document = 0;
    rank.rule = 1;
    rank.route = 2;
    rank.permission = 4;
    rank.label = 5;
  }
  return rank;
}

export function searchKnowledge(items: KnowledgeItem[], question: string, route: string): KnowledgeItem[] {
  const path = route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
  if (isPageQuestion(question)) {
    return items.filter((item) => item.kind === 'route' && item.route === path).slice(0, 1);
  }
  const tokens = tokensOf(question);
  if (tokens.length === 0) return [];
  const workflow = isProcedureQuestion(question);
  const permissionTopic = isPermissionTopic(question);
  const kindRank = kindRankFor(question, workflow, permissionTopic);

  const ranked = items
    .filter((item) => kindEligible(item, question, workflow, permissionTopic))
    .map((item) => {
      let score = scoreItem(item, tokens, path, workflow) - workflowDocPenalty(item, question);
      // Never boost every document — that made unrelated workflow cards win on route alone.
      if (permissionTopic && item.kind === 'permission') score += 4;
      if (item.id === 'rule:permissions-server-side' && isOwnerAllPermissionsQuestion(question)) score += 8;
      if (item.id === 'document:pos-sale-workflow' && /\bcheckout\b|الدفع|زر\s*الدفع/i.test(question)) score += 8;
      if (item.id === 'label:cash.expense' && /\bexpenses?\b|مصروف|المصاريف/i.test(question)) score += 12;
      if (item.kind === 'route' && item.route === '/users' && /users?|المستخدمين|مستخدم/i.test(question)) score += 10;
      // Product-name tokens alone must not promote the AI-access label.
      if (item.id === 'label:perm.canUseZelveroAI' && !/zelvero\s*ai|canUseZelveroAI|access\s+zelvero\s*ai|الوصول\s*إلى\s*zelvero/i.test(question)) {
        score -= 20;
      }
      return { item, score };
    })
    .filter((row) => row.score >= relevanceFloor(row.item.kind, workflow, permissionTopic))
    .sort((a, b) => b.score - a.score || kindRank[a.item.kind] - kindRank[b.item.kind] || a.item.id.localeCompare(b.item.id));

  return ranked.slice(0, 3).map((row) => row.item);
}

export function canUse(item: KnowledgeItem, ctx: AskContext): boolean {
  if (item.audience === 'public' || item.audience === 'member') return true;
  if (item.audience === 'owner') return ctx.isOwner;
  if (item.audience === 'superAdmin') return ctx.isSuperAdmin;
  if (item.audience === 'permission' && item.permission) return ctx.isOwner || ctx.can(item.permission);
  return false;
}

function wantsTechnicalSources(question: string): boolean {
  return /\bsources?\b|source\s*code|file\s*path|callable|المصادر|مسار\s*الملف|من\s*المصدر/i.test(question);
}

function preferKnowledgeCard(found: KnowledgeItem[], question: string, permissionTopic: boolean): KnowledgeItem | null {
  const order: KnowledgeItem['kind'][] = permissionTopic
    ? ['route', 'permission', 'rule', 'document', 'label']
    : ['document', 'route', 'rule', 'permission', 'label'];
  // Named UI controls (Expense, Checkout) beat a weakly related document.
  if (/expense|مصروف|checkout|زر\s*الدفع/i.test(question)) {
    const label = found.find((item) => item.kind === 'label' && !looksLikeInternalStub(item.body.en));
    if (label) return label;
  }
  if (/users?|المستخدمين|مستخدم/i.test(question)) {
    const usersRoute = found.find((item) => item.kind === 'route' && item.route === '/users');
    if (usersRoute) return usersRoute;
  }
  for (const kind of order) {
    const hit = found.find((item) => item.kind === kind);
    if (hit && !looksLikeInternalStub(hit.body.en)) return hit;
  }
  const first = found.find((item) => !looksLikeInternalStub(item.body.en));
  return first ?? null;
}

export function answerQuestion(items: KnowledgeItem[], ctx: AskContext): Answer {
  const lang = answerLanguage(ctx.question, ctx.lang);

  if (isFinancialCapabilityQuestion(ctx.question)) {
    return { status: 'answered', lang, text: financeCapabilityRefusalText(lang), sources: [], executes: false };
  }
  if (isProductOverviewQuestion(ctx.question)) {
    return { status: 'answered', lang, text: productOverviewText(lang), sources: [], executes: false };
  }
  if (isOwnerAllPermissionsQuestion(ctx.question)) {
    return { status: 'answered', lang, text: ownerPermissionsText(lang), sources: [], executes: false };
  }
  if (isSubUserSelfGrantAiQuestion(ctx.question)) {
    return { status: 'answered', lang, text: subUserSelfGrantAiText(lang), sources: [], executes: false };
  }
  // Unknown product features must not be answered from a weakly related card.
  if (looksLikeUnavailableFeature(ctx.question)) {
    return resolveKnowledgeMiss(items, ctx, lang);
  }
  const found = searchKnowledge(items, ctx.question, ctx.route);
  const permissionTopic = isPermissionTopic(ctx.question);
  const preferred = preferKnowledgeCard(found, ctx.question, permissionTopic);
  if (!preferred) {
    const fallback = resolveKnowledgeMiss(items, ctx, lang);
    if (isGenericUnsupportedAnswer(fallback.text)) {
      return {
        status: 'unknown',
        lang,
        text:
          lang === 'ar'
            ? 'بساعد ضمن Zelvero POS: الشاشات، الصلاحيات، خطوات العمل، والتنقّل. شو بدك تعمل أو تعرف؟'
            : 'I help with Zelvero POS screens, permissions, workflows, and navigation. What do you want to do or know?',
        sources: [],
        executes: false,
      };
    }
    return {
      ...fallback,
      text: sanitizeUserFacingText(fallback.text),
    };
  }
  const sources = wantsTechnicalSources(ctx.question)
    ? found.map((item) => ({
        id: item.id,
        path: item.source.path,
        symbol: item.source.symbol,
        startLine: item.source.startLine,
        endLine: item.source.endLine,
      }))
    : [];
  const raw = preferred.body[lang];
  // If the best card is still an internal stub, fall through instead of sanitizing a wrong answer.
  if (looksLikeInternalStub(raw)) {
    const fallback = resolveKnowledgeMiss(items, ctx, lang);
    return { ...fallback, text: sanitizeUserFacingText(fallback.text) };
  }
  return {
    status: 'answered',
    lang,
    text: sanitizeUserFacingText(raw),
    sources,
    executes: false,
  };
}
