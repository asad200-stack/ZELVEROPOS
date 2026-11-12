/**
 * Structured follow-up offers (e.g. "I can open Products if you want")
 * and short yes/no replies that must resolve against them — not knowledge search.
 */

import { NAV_ITEMS } from '@/app/navigation';
import type { PermissionKey } from '@/constants/permissions';
import type { NavItem } from '@/app/navigation';
import type { PageUiPath } from './pageUiBridge';

export type NavigateOfferPath =
  | '/products'
  | '/sales'
  | '/cashbox'
  | '/pos'
  | '/customers'
  | '/suppliers'
  | '/purchases'
  | '/dashboard'
  | '/reports'
  | '/settings'
  | '/expiry'
  | '/users';

export type PendingNavigateOffer = {
  kind: 'offerNavigate';
  path: string;
  labelKey: NavItem['label'];
  permission?: PermissionKey;
  ownerOnly?: boolean;
  /** When true, also open that page's Add/Create form (never pay/debt/cash). */
  openCreateForm?: boolean;
  prompt: { en: string; ar: string };
  submissionId: string;
};

const CREATE_FORM_PATHS = new Set<string>(['/products', '/customers', '/suppliers', '/purchases']);

const CREATE_FORM_PROMPT: Record<PageUiPath, { en: string; ar: string }> = {
  '/products': {
    en: 'Would you like me to open Products and the Add product form?',
    ar: 'إذا بتحب، فيني افتحلك صفحة المنتجات ونموذج إضافة منتج.',
  },
  '/customers': {
    en: 'Would you like me to open Customers and the Add customer form?',
    ar: 'إذا بتحب، فيني افتحلك صفحة الزبائن ونموذج إضافة زبون.',
  },
  '/suppliers': {
    en: 'Would you like me to open Suppliers and the Add supplier form?',
    ar: 'إذا بتحب، فيني افتحلك صفحة الموردين ونموذج إضافة مورد.',
  },
  '/purchases': {
    en: 'Would you like me to open Purchases and the New purchase form?',
    ar: 'إذا بتحب، فيني افتحلك صفحة المشتريات ونموذج فاتورة شراء جديدة.',
  },
};

const SOFT_YES =
  /^(إيه|ايه|اي|أي|أيوه|ايوه|نعم|أكيد|اكيد|تفضّ?ل|موافق|yes|yeah|yep|sure|ok|okay|go\s*ahead|please\s*do)$/i;

const SOFT_NO =
  /^(لا|لأ|لا\s*شكرً?ا|مش\s*هلأ|مش\s*الآن|مو\s*هلأ|no|nope|not\s*now|never\s*mind|cancel)$/i;

/** Short reply that is neither a clear yes nor no (needs clarification when an offer is pending). */
const SHORT_AMBIGUOUS = /^(مم+|اه+|uh+|hm+|hmm+|maybe|يمكن|ممكن|بس|شوف|خلينا\s*نشوف)$/i;

export function supportsCreateForm(path: string): path is PageUiPath {
  return CREATE_FORM_PATHS.has(path);
}

export function isSoftAffirmative(text: string): boolean {
  return SOFT_YES.test(text.trim());
}

export function isSoftNegative(text: string): boolean {
  return SOFT_NO.test(text.trim());
}

export function isShortAmbiguousFollowUp(text: string): boolean {
  const q = text.trim();
  if (q.length > 32) return false;
  if (isSoftAffirmative(q) || isSoftNegative(q)) return false;
  return SHORT_AMBIGUOUS.test(q);
}

export function buildNavigateOffer(
  path: NavigateOfferPath,
  submissionId: string,
  options?: { openCreateForm?: boolean },
): PendingNavigateOffer | null {
  const item = NAV_ITEMS.find((row) => row.path === path);
  if (!item) return null;
  const openCreateForm = Boolean(options?.openCreateForm && supportsCreateForm(path));
  const formPrompt = openCreateForm && supportsCreateForm(path) ? CREATE_FORM_PROMPT[path] : null;
  return {
    kind: 'offerNavigate',
    path: item.path,
    labelKey: item.label,
    permission: item.permission,
    ownerOnly: item.ownerOnly,
    openCreateForm,
    prompt: formPrompt ?? {
      en: `Would you like me to open ${path.replace('/', '')}?`,
      ar: 'إذا بتحب، فيني افتحلك هالصفحة.',
    },
    submissionId,
  };
}

export function noPendingAffirmText(lang: 'ar' | 'en'): string {
  return lang === 'ar' ? 'شو قصدك؟ قلّي شو بدك أعمل.' : 'What did you mean? Tell me what you want me to do.';
}

export function offerClarificationText(lang: 'ar' | 'en', prompt: { en: string; ar: string }): string {
  return lang === 'ar'
    ? `للتأكيد: ${prompt.ar} جاوب بنعم أو لا.`
    : `Just to confirm: ${prompt.en} Reply yes or no.`;
}

export function offerRejectedText(lang: 'ar' | 'en'): string {
  return lang === 'ar' ? 'تمام، ما فتحت شي.' : 'Okay, I did not open anything.';
}

export function createFormOpenedText(path: string, title: string, lang: 'ar' | 'en'): string {
  if (lang === 'ar') {
    if (path === '/products') return `تم فتح ${title} ونموذج إضافة منتج.`;
    if (path === '/customers') return `تم فتح ${title} ونموذج إضافة زبون.`;
    if (path === '/suppliers') return `تم فتح ${title} ونموذج إضافة مورد.`;
    if (path === '/purchases') return `تم فتح ${title} ونموذج فاتورة شراء جديدة.`;
    return `تم فتح ${title}.`;
  }
  if (path === '/products') return `Opening ${title} and the Add product form.`;
  if (path === '/customers') return `Opening ${title} and the Add customer form.`;
  if (path === '/suppliers') return `Opening ${title} and the Add supplier form.`;
  if (path === '/purchases') return `Opening ${title} and the New purchase form.`;
  return `Opening ${title}.`;
}

export function createFormDeniedText(path: string, title: string, lang: 'ar' | 'en'): string {
  if (lang === 'ar') {
    if (path === '/products') return `تم فتح ${title}. ما عندك صلاحية إضافة منتج، فما فتحت النموذج.`;
    return `تم فتح ${title}. ما عندك صلاحية تفتح نموذج الإضافة.`;
  }
  if (path === '/products') return `Opening ${title}. You cannot add products, so the form was not opened.`;
  return `Opening ${title}. You cannot open the create form.`;
}
