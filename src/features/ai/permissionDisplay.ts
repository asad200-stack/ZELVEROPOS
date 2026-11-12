/**
 * User-facing permission wording from verified POS labels (i18n `perm.*`).
 * Never invent meanings — only keys listed in PERMISSION_KEYS.
 */

import { PERMISSION_KEYS, type PermissionKey } from '@/constants/permissions';

/** English display names — must match `src/i18n/en.ts` `perm.*`. */
const EN: Record<PermissionKey, string> = {
  canSell: 'Sell (point of sale)',
  canEditPrice: 'Change prices in the cart',
  canViewSales: 'View sales & returns',
  canViewProducts: 'View products',
  canAddProducts: 'Add products',
  canEditProducts: 'Edit products & stock',
  canDeleteProducts: 'Delete products',
  canImportProducts: 'Import products',
  canExportProducts: 'Export products',
  canViewCustomers: 'Customers & debts',
  canViewReports: 'Reports & dashboard figures',
  canViewSuppliers: 'Suppliers & purchases',
  canManageCashDrawer: 'Cash drawer',
  canViewSettings: 'View settings',
  canEditSettings: 'Edit settings',
  canViewCosts: 'View costs & profit',
  canViewSensitiveData: 'Sensitive data (backup, Telegram)',
  canUseZelveroAI: 'Access Zelvero AI',
};

/** Arabic display names — must match `src/i18n/ar.ts` `perm.*`. */
const AR: Record<PermissionKey, string> = {
  canSell: 'البيع (نقطة البيع)',
  canEditPrice: 'تعديل الأسعار في السلة',
  canViewSales: 'عرض المبيعات والمرتجعات',
  canViewProducts: 'عرض المنتجات',
  canAddProducts: 'إضافة منتجات',
  canEditProducts: 'تعديل المنتجات والمخزون',
  canDeleteProducts: 'حذف المنتجات',
  canImportProducts: 'استيراد المنتجات',
  canExportProducts: 'تصدير المنتجات',
  canViewCustomers: 'الزبائن والديون',
  canViewReports: 'التقارير وأرقام لوحة التحكم',
  canViewSuppliers: 'الموردون والمشتريات',
  canManageCashDrawer: 'الصندوق',
  canViewSettings: 'عرض الإعدادات',
  canEditSettings: 'تعديل الإعدادات',
  canViewCosts: 'عرض التكاليف والأرباح',
  canViewSensitiveData: 'البيانات الحساسة (النسخ الاحتياطي، تيليجرام)',
  canUseZelveroAI: 'الوصول إلى Zelvero AI',
};

export function permissionDisplayName(key: PermissionKey, lang: 'en' | 'ar'): string {
  return lang === 'ar' ? AR[key] : EN[key];
}

/** Replace raw `canX` keys in user-facing prose with verified labels. */
export function humanizePermissionKeys(text: string, lang: 'en' | 'ar' = 'en'): string {
  let out = text;
  // Full stub cards from knowledge draft.
  out = out.replace(
    /\b(can[A-Z][A-Za-z0-9]*)\s+is a local permission key\.\s*Its English name is "([^"]+)"\.\s*Its Arabic name is "([^"]+)"\.\s*Owners implicitly have it\.\s*/gi,
    (_m, _key: string, enName: string, arName: string) => {
      // English stub template → English label even if Arabic name appears in the card.
      const label = lang === 'ar' ? arName : enName;
      return lang === 'ar'
        ? `الصلاحية المطلوبة هي «${label}». المالك يملكها ضمنياً. `
        : `The required permission is “${label}”. Owners have it by default. `;
    },
  );
  out = out.replace(
    /\b(can[A-Z][A-Za-z0-9]*)\s+مفتاح صلاحية في المصدر المحلي\.\s*اسمه بالإنجليزية "([^"]+)"\.\s*واسمه بالعربية «([^»]+)»\.\s*المالك يملكه ضمنياً\.\s*/gi,
    (_m, _key: string, enName: string, arName: string) =>
      `الصلاحية المطلوبة هي «${arName || enName}». المالك يملكها ضمنياً. `,
  );
  // "Opening it requires canViewX." / "فتحها يتطلب canViewX."
  out = out.replace(/\bOpening it requires (can[A-Z][A-Za-z0-9]*(?:\s+or\s+can[A-Z][A-Za-z0-9]*)*)\./gi, (_m, keys: string) => {
    return `Opening it requires ${humanizeKeyList(keys, 'en')}.`;
  });
  out = out.replace(/فتحها يتطلب (can[A-Z][A-Za-z0-9]*(?:\s+or\s+can[A-Z][A-Za-z0-9]*)*)\./gi, (_m, keys: string) => {
    return `فتحها يتطلب ${humanizeKeyList(keys, 'ar')}.`;
  });
  out = out.replace(/\bIt requires (can[A-Z][A-Za-z0-9]*(?:\s+or\s+can[A-Z][A-Za-z0-9]*)*)\./gi, (_m, keys: string) => {
    return `It requires ${humanizeKeyList(keys, lang)}.`;
  });
  out = out.replace(/الصلاحية المطلوبة هي (can[A-Z][A-Za-z0-9]*(?:\s+or\s+can[A-Z][A-Za-z0-9]*)*)\./gi, (_m, keys: string) => {
    return `الصلاحية المطلوبة هي ${humanizeKeyList(keys, 'ar')}.`;
  });
  // Bare keys remaining (longest first to avoid partials).
  const keys = [...PERMISSION_KEYS].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const label = permissionDisplayName(key, lang);
    const re = new RegExp(`\\b${key}\\b`, 'g');
    out = out.replace(re, lang === 'ar' ? `«${label}»` : `“${label}”`);
  }
  out = out.replace(/\s*Zelvero AI cannot grant it\.\s*/gi, ' ');
  out = out.replace(/\s*Zelvero AI لا يستطيع منحه\.\s*/gi, ' ');
  return out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function humanizeKeyList(keys: string, lang: 'en' | 'ar'): string {
  const parts = keys.split(/\s+or\s+/i).map((k) => k.trim());
  const labels = parts.map((k) => {
    if ((PERMISSION_KEYS as readonly string[]).includes(k)) {
      const label = permissionDisplayName(k as PermissionKey, lang);
      return lang === 'ar' ? `«${label}»` : `“${label}”`;
    }
    return k;
  });
  if (lang === 'ar') return labels.join(' أو ');
  return labels.join(' or ');
}
