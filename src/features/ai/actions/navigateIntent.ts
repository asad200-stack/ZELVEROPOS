import { NAV_ITEMS, type NavItem } from '@/app/navigation';
import type { PermissionKey } from '@/constants/permissions';

export interface NavigateMatch {
  path: string;
  labelKey: NavItem['label'];
  permission?: PermissionKey;
  ownerOnly?: boolean;
  /** Reports tab to open with the page. */
  tab?: 'sales' | 'profit' | 'inventory' | 'customers' | 'capital' | 'expenses';
  /** Confirmation name when the destination is a tab, not the whole page. */
  title?: { ar: string; en: string };
  /** Cost tabs are hidden without this permission. */
  extraPermission?: PermissionKey;
}

/** Phrase → route. Only paths that exist in NAV_ITEMS. (`\b` is weak for Arabic — use plain includes patterns.) */
const ALIASES: { path: string; patterns: RegExp }[] = [
  { path: '/dashboard', patterns: /dashboard|\bhome\b|الرئيسية|الداشبورد/i },
  { path: '/pos', patterns: /\bpos\b|point\s*of\s*sale|cashier|\bcart\b|الكاشير|نقطة\s*البيع|الكارت/i },
  { path: '/cashbox', patterns: /cash\s*box|cashbox|cash\s*drawer|\bdrawer\b|الصندوق|الدرج/i },
  { path: '/products', patterns: /\bproducts?\b|\bitems?\b|\bskus?\b|catalog|inventory\s*list|المنتجات|المواد|الأصناف|الاصناف|الكتالوج/i },
  { path: '/expiry', patterns: /expir(?:y|ation)|صلاحية|انتهاء/i },
  { path: '/sales', patterns: /\bsales\b|sales\s*history|\binvoices?\b|\breceipts?\b|\breturns?\b|المبيعات|الفواتير|المرتجعات?|مرتجع/i },
  { path: '/customers', patterns: /\bcustomers?\b|\bclients?\b|الزبائن|العملاء/i },
  { path: '/suppliers', patterns: /\bsuppliers?\b|\bvendors?\b|الموردين|المورّدين/i },
  { path: '/purchases', patterns: /\bpurchases?\b|purchase\s*orders?|المشتريات/i },
  { path: '/reports', patterns: /\breports?\b|analytics|التقارير/i },
  { path: '/users', patterns: /\busers?\b|\bstaff\b|\bemployees?\b|المستخدمين|الموظفين/i },
  { path: '/settings', patterns: /\bsettings?\b|preferences|الإعدادات/i },
];

/** Report tabs. Checked before page aliases so “capital” is not dropped. */
const REPORT_TABS: {
  tab: NonNullable<NavigateMatch['tab']>;
  patterns: RegExp;
  title: { ar: string; en: string };
  extraPermission?: PermissionKey;
}[] = [
  { tab: 'capital', patterns: /كابيتال|كابيتل|كابيتول|رأس\s*المال|\bcapital\b/i, title: { ar: 'رأس المال', en: 'Capital' }, extraPermission: 'canViewCosts' },
  { tab: 'profit', patterns: /الأرباح|الارباح|\bprofit\b/i, title: { ar: 'الأرباح', en: 'Profit' }, extraPermission: 'canViewCosts' },
  { tab: 'expenses', patterns: /المصاريف|\bexpenses?\b/i, title: { ar: 'المصاريف', en: 'Expenses' } },
  { tab: 'inventory', patterns: /\binventory\b(?!\s*list)|تبويب\s*المخزون/i, title: { ar: 'المخزون', en: 'Inventory' } },
];

const NAV_VERB =
  /\b(open|go\s+to|take\s+me|navigate|bring\s+me|switch\s+to|show\s+me|display)\b|افتح(?:لي)?|فوتني|فوتني\s*على|ودّيني|وديني|خدني|روح(?:ي)?\s*(?:على|ل)|ورجيني|فرجيني|انتقل/i;

/** Pure navigation — not a how-to (those are guides that may only *offer* to open). */
/** A figure or product-condition question, not a request to open a page. */
const DATA_NOT_NAVIGATION =
  /high\s+stock|low\s+sales|overstock|reorder|which products|hasn'?t sold|losing popularity|days of (?:stock|cover)|gross profit|مخزون\s*(?:عالي|كثير)|مبيعات\s*(?:قليلة|نازلة)|بدي\s*(?:اعرف|أعرف)\s*.{0,24}ربح/i;

export function isNavigationRequest(text: string): boolean {
  const q = text.trim();
  if (DATA_NOT_NAVIGATION.test(q)) return false;
  // "ورجيني وين بعمل المرتجع" is guidance, not navigate-now.
  if (/ورجيني\s*وين|فرجيني\s*وين|show\s+me\s+where|where\s+(?:do|can)\s+i/i.test(q)) return false;
  if (/كيف|how\s+do|how\s+to|علّ?مني|طريقة/i.test(q)) return false;
  if (!NAV_VERB.test(q) && !/^(المنتجات|المبيعات|الصندوق|الكاشير|التقارير|الإعدادات|الزبائن|الموردين|المشتريات)$/i.test(q)) {
    if (!/^(products?|pos|sales|cashbox|customers?|suppliers?|purchases?|reports?|settings?|dashboard|expiry|users?)$/i.test(q)) {
      return false;
    }
  }
  return Boolean(resolveNavigateTarget(q));
}

export function resolveNavigateTarget(text: string): NavigateMatch | null {
  const q = text.trim();
  const reports = NAV_ITEMS.find((row) => row.path === '/reports');
  if (reports) {
    for (const tab of REPORT_TABS) {
      if (!tab.patterns.test(q)) continue;
      return {
        path: reports.path,
        labelKey: reports.label,
        permission: reports.permission,
        tab: tab.tab,
        title: tab.title,
        extraPermission: tab.extraPermission,
      };
    }
  }
  for (const alias of ALIASES) {
    if (!alias.patterns.test(q)) continue;
    const item = NAV_ITEMS.find((row) => row.path === alias.path);
    if (!item) continue;
    return {
      path: item.path,
      labelKey: item.label,
      permission: item.permission,
      ownerOnly: item.ownerOnly,
    };
  }
  return null;
}

export function canAccessNav(
  match: NavigateMatch,
  ctx: { isOwner: boolean; can: (permission: PermissionKey) => boolean },
): boolean {
  if (match.ownerOnly) return ctx.isOwner;
  if (match.extraPermission && !ctx.isOwner && !ctx.can(match.extraPermission)) return false;
  if (match.permission) return ctx.isOwner || ctx.can(match.permission);
  return true;
}
