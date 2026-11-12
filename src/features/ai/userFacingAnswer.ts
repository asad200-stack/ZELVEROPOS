/**
 * Presentation layer for knowledge answers.
 * Does not invent content — only cleans verified text for end users.
 */

import { humanizePermissionKeys } from './permissionDisplay';

const WORKING_TREE_DISCLAIMER =
  /\s*This is from the local working tree, not a production deployment check\.?/gi;
const WORKING_TREE_DISCLAIMER_AR =
  /\s*هذه المعلومة من شجرة المصدر المحلية، وليست تأكيداً أن الميزة منشورة في الإنتاج\.?/gi;

const CANNOT_OPEN =
  /\s*Zelvero AI cannot open (?:it|them|this(?: page)?)(?: for you)?\.?/gi;
const CANNOT_OPEN_AR = /\s*Zelvero AI لا يستطيع فتحها نيابة عنك\.?/gi;
const CANNOT_PRESS = /\s*Zelvero AI cannot press this control\.?/gi;
const CANNOT_PRESS_AR = /\s*Zelvero AI لا يستطيع الضغط على هذا العنصر\.?/gi;
const CANNOT_CALL = /\s*Zelvero AI cannot call this function\.?/gi;
const CANNOT_CALL_AR = /\s*Zelvero AI لا يستطيع استدعاء هذه الدالة\.?/gi;
const CANNOT_RUN_TEST = /\s*Zelvero AI cannot run the test\.?/gi;
const CANNOT_GRANT = /\s*Zelvero AI cannot grant it\.?/gi;
const CANNOT_CHANGE_PERMS = /\s*Zelvero AI cannot change permissions\.?/gi;

const ROUTE_PATH_DUMP = /\s*The route is \/[^\s.]+\.?/gi;
const SRC_PATH = /\bsrc\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|md)\b/g;
const TEST_FILE = /\b[\w./-]+\.test\.(?:ts|tsx|js)\b/g;
const CALLABLE_LEAD =
  /\b(?:pos|admin|plan|create|delete|update|import|export)[A-Z][A-Za-z0-9]*\s+is a Cloud Function[^.]*\./gi;

/** True when a knowledge body is mostly an internal stub (callable/test dump). */
export function looksLikeInternalStub(text: string): boolean {
  if (/\bis a Cloud Function\b|local test file|This records the test name only/i.test(text)) return true;
  if (/\.test\.(?:ts|tsx)\b/.test(text) && /cannot run the test/i.test(text)) return true;
  return false;
}

/**
 * Clean a verified card body for chat. Prefer rewriting route wording so we never
 * claim the AI cannot navigate when navigation is allowlisted.
 */
export function sanitizeUserFacingText(text: string): string {
  let out = text;
  out = out.replace(WORKING_TREE_DISCLAIMER, '');
  out = out.replace(WORKING_TREE_DISCLAIMER_AR, '');
  out = out.replace(CANNOT_OPEN, '');
  out = out.replace(CANNOT_OPEN_AR, '');
  out = out.replace(CANNOT_PRESS, '');
  out = out.replace(CANNOT_PRESS_AR, '');
  out = out.replace(CANNOT_CALL, '');
  out = out.replace(CANNOT_CALL_AR, '');
  out = out.replace(CANNOT_RUN_TEST, '');
  out = out.replace(CANNOT_GRANT, '');
  out = out.replace(CANNOT_CHANGE_PERMS, '');
  out = out.replace(CALLABLE_LEAD, '');
  out = out.replace(SRC_PATH, '');
  out = out.replace(TEST_FILE, '');
  out = out.replace(ROUTE_PATH_DUMP, '');
  out = out.replace(/\s*المسار\s*\/[^\s.]+\.?/gi, '');
  // Soften "The menu label is X. The route is /y." leftovers
  out = out.replace(/\s*The local handler asks for [A-Za-z]+\.\s*/gi, ' ');
  // Drop internal callable / page symbols from workflow prose.
  out = out.replace(/\b(?:planReturn|posReturn|posCheckout|posCreateProduct|PosPage)\b/g, '');
  out = out.replace(/\(\s*from\s+[^)]*\)/gi, '');
  out = out.replace(/\(\s*من\s+[^)]*\)/gi, '');
  // Prefer the language of the surrounding prose (English stub cards stay English).
  const preferAr =
    /[\u0600-\u06FF]/.test(out) &&
    !/\bis a local permission key\b|\bOpening it requires\b|\bIts English name\b/i.test(out);
  out = humanizePermissionKeys(out, preferAr ? 'ar' : 'en');
  out = out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

export function productOverviewText(lang: 'en' | 'ar'): string {
  if (lang === 'ar') {
    return [
      'Zelvero POS هو نظام نقطة بيع للمتجر: بيع، منتجات، زبائن، موردين، مشتريات، صندوق، مرتجعات، وتقارير.',
      'بتقدر تفتح الشاشات من القائمة، وZelvero AI بيساعدك بالشرح والتنقّل وخطوات العمل — من دون ما ينفّذ دفع أو حركة صندوق من الدردشة.',
    ].join('\n');
  }
  return [
    'Zelvero POS is a store point-of-sale system for sales, products, customers, suppliers, purchases, cash drawer, returns, and reports.',
    'You use the app screens for day-to-day work. Zelvero AI can explain workflows, open allowed pages, and prepare a few safe steps — it does not complete payments or cash movements from chat.',
  ].join('\n');
}

export function ownerPermissionsText(lang: 'en' | 'ar'): string {
  if (lang === 'ar') {
    return 'المالك يملك كل الصلاحيات ضمنياً. الصلاحيات تُطبَّق من الخادم عبر الـ claims، وواجهة المستخدم للتجربة فقط. Zelvero AI ما بيغيّر الصلاحيات.';
  }
  return 'The store owner implicitly has every permission. Permissions are enforced server-side through custom claims; UI checks are for experience only. Zelvero AI cannot change permissions.';
}

export function isProductOverviewQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\bwhat\s+is\s+zelvero(?:\s+pos)?\b|\bwhat\s+is\s+this\s+(?:pos|system|app)\b/i.test(q) ||
    /(?:شو|ما)\s*(?:هي|هو)?\s*zelvero(?:\s*pos)?|zelvero\s*pos\s*(?:شو|إيه|ايش)|عرّف(?:ني)?\s*(?:على\s*)?zelvero/i.test(q)
  );
}

export function isOwnerAllPermissionsQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\bowner\b.+\b(?:all|every)\s+permissions?\b|\b(?:all|every)\s+permissions?\b.+\bowner\b/i.test(q) ||
    /المالك.+(?:كل|جميع)\s*الصلاح|هل\s*المالك\s*عندو\s*(?:كل|جميع)/i.test(q)
  );
}

export function isSubUserSelfGrantAiQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /sub[- ]?user.+(?:grant|give|enable).+(?:ai|zelvero|permission)|(?:grant|give)\s+themselves\s+(?:ai|zelvero|permission)/i.test(
      q,
    ) ||
    /can\s+a\s+sub[- ]?user\s+grant\s+themselves/i.test(q) ||
    /موظف.+(?:يعطي|يمنح)\s*نفسه.+(?:ai|zelvero|صلاح)|يمنح\s*نفسه\s*(?:صلاح|ai|zelvero)|صلاحية\s*الـ?\s*ai/i.test(q)
  );
}

export function subUserSelfGrantAiText(lang: 'en' | 'ar'): string {
  if (lang === 'ar') {
    return 'لا. المستخدم الفرعي ما بيقدر يمنح نفسه صلاحية Zelvero AI أو أي صلاحية تانية. المالك وحده بيدير المستخدمين ويضبط الصلاحيات من صفحة المستخدمين. Zelvero AI ما بيغيّر صلاحيات.';
  }
  return 'No. A sub-user cannot grant themselves Zelvero AI access or any other permission. Only the store owner manages users and sets permissions on the Users page. Zelvero AI cannot change permissions.';
}
