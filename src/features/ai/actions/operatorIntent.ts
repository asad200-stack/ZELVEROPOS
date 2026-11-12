/**
 * Separates Explain / Navigate / Execute so how-to never starts a product draft or cart mutation.
 */

export type OperatorIntentKind =
  | 'guide'
  | 'navigate'
  | 'createProduct'
  | 'createCustomer'
  | 'createSupplier'
  | 'createPurchase'
  | 'cartAdd'
  | 'cartRemove'
  | 'finance'
  | 'confirm'
  | 'cancel'
  | 'ambiguous'
  | 'other';

/** How-to / teach-me markers (EN + Lebanese/MSA Arabic). */
export const GUIDE_HINT =
  /\bhow\s+do\s+i\b|\bhow\s+to\b|\bhow\s+does\b|\bhow\s+do\s+\w[\w\s]{0,48}\bwork\b|\bwhat\s+is\s+the\s+difference\b|\bdifference\s+between\b|\bwhat\s+happens\b|\bwhere\s+(?:is|do|can)\b|\bwhich\s+button\b|\bexplain\b|\bteach\s+me\b|\bshow\s+me\s+how\b|\bwalk(?:\s+me)?\s+through\b|\binstructions?\b|\bsteps?\b|\bworkflow\b|كيف\s*ب(?:ضيف|عمل|فتح|بيع|رجع|شتغل|ستلم|سدد|حصّل|حدد|شوف|عدّل)|كيف\s*أ(?:ضيف|عمل|فتح|ستلم|سدد)|كيف\s*(?:ب)?(?:ي)?شتغل|كيف\s*يعمل|شو\s*الفرق|ما\s*(?:هو\s*)?الفرق|علّ?مني|علمني|بدّ?ي\s*أعرف|بدي\s*اعرف|طريقة\s*(?:إضافة|اضافة|البيع|المرتجع|التسديد|استلام)|اشرح|وين\s*(?:فيني|بقدر)|ورجيني\s*وين|فرجيني\s*وين|شو\s*الخطوات/i;

export function isGuideIntent(text: string): boolean {
  return GUIDE_HINT.test(text.trim());
}

/**
 * Imperative create (not how-to).
 * "Add a new product" / "ضيفلي منتج جديد" → true
 * "How do I add a product?" / "كيف بضيف منتج؟" → false
 */
/** Cart / sale line context — never treat as catalog product creation. */
export function hasCartContext(text: string): boolean {
  return (
    /\b(?:to\s+(?:the\s+)?)?(?:cart|sale)\b|\bin\s+(?:the\s+)?cart\b|بالسلة|للسلة|عالسلة|بالكارت|للكارت|بالعربة|للعربة/i.test(
      text,
    )
  );
}

export function isExecuteCreateProduct(text: string): boolean {
  const q = text.trim();
  if (isGuideIntent(q)) return false;
  if (isGuideIntent(q.replace(/^(please|لو\s*سمحت)\s+/i, ''))) return false;
  if (hasCartContext(q)) return false;
  return (
    /\b(?:please\s+)?(?:i\s+(?:need|want|wanna|would\s+like|'d\s+like)\s+to\s+)?(?:add|create|register)\s+(?:a|an|the)?\s*(?:new\s+)?(?:product|item|sku)s?\b/i.test(
      q,
    ) ||
    /\bnew\s+(?:product|item|sku)\b/i.test(q) ||
    /^add\s+(?!a\s+(?:new\s+)?(?:product|item|customer|client|supplier)\b).+\sfor\s+\d+(?:\.\d{1,2})?\s+dollars?\b/i.test(q) ||
    /ضيف(?:لي|لنا)?\s*(?:منتج|مادة|صنف|غرض)|أضف(?:لي)?\s*(?:منتج|مادة|صنف|غرض)|منتج\s*جديد|صنف\s*جديد|إنشاء\s*منتج|(?:بدّ?ي|بدي|لازم|حابب)\s*(?:ضيف|أضيف|اضيف|اعمل)\s*(?:منتج|مادة|صنف|غرض)/i.test(
      q,
    )
  );
}

export function isExecuteCreateCustomer(text: string): boolean {
  const q = text.trim();
  if (isGuideIntent(q)) return false;
  return (
    /\b(?:please\s+)?(?:i\s+(?:need|want|wanna|would\s+like|'d\s+like)\s+to\s+)?(?:add|create|register)\s+(?:a|an|the)?\s*(?:new\s+)?(?:customer|client)s?\b/i.test(
      q,
    ) ||
    /\bnew\s+(?:customer|client)\b/i.test(q) ||
    /ضيف(?:لي|لنا)?\s*(?:زبون|عميل)|أضف(?:لي)?\s*(?:زبون|عميل)|زبون\s*جديد|عميل\s*جديد|إنشاء\s*زبون|(?:بدّ?ي|بدي|لازم)\s*(?:ضيف|أضيف|اضيف|اعمل)\s*(?:زبون|عميل)/i.test(
      q,
    )
  );
}

export function isExecuteCreateSupplier(text: string): boolean {
  const q = text.trim();
  if (isGuideIntent(q)) return false;
  return (
    /\b(?:please\s+)?(?:i\s+(?:need|want|wanna|would\s+like|'d\s+like)\s+to\s+)?(?:add|create|register)\s+(?:a|an|the)?\s*(?:new\s+)?(?:supplier|vendor)s?\b/i.test(
      q,
    ) ||
    /\bnew\s+(?:supplier|vendor)\b/i.test(q) ||
    /ضيف(?:لي|لنا)?\s*مورد|أضف(?:لي)?\s*مورد|مورد\s*جديد|إنشاء\s*مورد|(?:بدّ?ي|بدي|لازم)\s*(?:ضيف|أضيف|اضيف|اعمل)\s*مورد/i.test(q)
  );
}

export function isExecuteCreatePurchase(text: string): boolean {
  const q = text.trim();
  if (isGuideIntent(q)) return false;
  return (
    /\b(?:please\s+)?(?:i\s+(?:need|want|wanna|would\s+like|'d\s+like)\s+to\s+)?(?:add|create|register)\s+(?:a|an|the)?\s*(?:new\s+)?purchase(?:\s+(?:bill|invoice))?\b/i.test(
      q,
    ) ||
    /\bnew\s+purchase(?:\s+(?:bill|invoice))?\b/i.test(q) ||
    /ضيف(?:لي|لنا)?\s*(?:شراء|فاتورة\s*شراء)|أضف(?:لي)?\s*(?:شراء|فاتورة\s*شراء)|فاتورة\s*شراء\s*جديدة|شراء\s*جديد|بدّ?ي\s*(?:ضيف|أضيف|اعمل)\s*(?:شراء|فاتورة\s*شراء)/i.test(
      q,
    )
  );
}

/** Cart prep (not how-to, not bare navigate). */
export function isExecuteCartAdd(text: string): boolean {
  const q = text.trim();
  if (isGuideIntent(q)) return false;
  return (
    /\b(?:add|put)\b.+\b(?:cart|sale)\b|\badd\s+.+\s+to\s+(?:the\s+)?cart\b/i.test(q) ||
    /(?:حط(?:لي)?|ضيف(?:لي)?|أضف(?:لي)?).+(?:بالكارت|بالسلة|للسلة|عالسلة|كارت)/i.test(q) ||
    /بدّ?ي\s*بيع\s+\S+/i.test(q)
  );
}

export function isExecuteCartRemove(text: string): boolean {
  const q = text.trim();
  if (isGuideIntent(q)) return false;
  return /\b(?:remove|delete)\b.+\b(?:cart|line|item)?|\bremove\s+one\b|شيل(?:لي)?|احذف|نقص/i.test(q);
}

export function classifyOperatorIntent(text: string): OperatorIntentKind {
  const q = text.trim();
  if (!q) return 'other';

  // Confirm/cancel checked by caller against pending; still useful as tags.
  if (/^(confirm|yes|ok|okay|do\s+it|go\s+ahead|create\s+it|save|أكّ?د|تأكيد|نعم|اي|أيوه|موافق|احفظ|أنشئ)$/i.test(q)) {
    return 'confirm';
  }
  if (/^(cancel|never\s*mind|stop|abort|لا|الغِ|إلغاء|بطل|وقف)$/i.test(q)) {
    return 'cancel';
  }

  // Guide always wins over create/cart keyword overlap.
  if (isGuideIntent(q)) return 'guide';

  // Cart before create — "add product to cart" must not start a product draft.
  if (isExecuteCartAdd(q)) return 'cartAdd';
  if (isExecuteCartRemove(q)) return 'cartRemove';
  if (isExecuteCreateProduct(q)) return 'createProduct';
  if (isExecuteCreateCustomer(q)) return 'createCustomer';
  if (isExecuteCreateSupplier(q)) return 'createSupplier';
  if (isExecuteCreatePurchase(q)) return 'createPurchase';

  return 'other';
}
