import type { ProductInput } from '@/services/productService';
import type { TierPrices } from '@/types/models';
import { isExecuteCreateProduct, isGuideIntent } from './operatorIntent';

export interface ProductDraftFields {
  name?: string;
  retailUsdCents?: number;
  /** Set only when the user stated a wholesale price. Never copied from retail. */
  wholesaleUsdCents?: number;
  /** Set only when the user stated a VIP price. Never copied from retail. */
  vipUsdCents?: number;
  costUsdCents?: number;
  barcode?: string;
  category?: string;
  initialStock?: number;
  minStock?: number | null;
}

export type ProductDraftMissing = 'name' | 'retailUsdCents';

const CONFIRM =
  /^(confirm|yes|yeah|yep|sure|ok|okay|do\s+it|go\s*ahead|create\s+it|save|أكّ?د|أكيد|اكيد|تأكيد|تفضّ?ل|نعم|اي|أي|إيه|ايه|أيوه|ايوه|موافق|احفظ|أنشئ)$/i;
const CANCEL =
  /^(cancel|never\s*mind|stop|abort|no|nope|not\s*now|لا|لأ|الغِ|إلغاء|بطل|وقف|مش\s*هلأ|مش\s*الآن|مو\s*هلأ)$/i;

export function isConfirmUtterance(text: string): boolean {
  return CONFIRM.test(text.trim());
}

export function isCancelUtterance(text: string): boolean {
  return CANCEL.test(text.trim());
}

export function isCreateProductRequest(text: string): boolean {
  // Cart line requests are never catalog create.
  if (/\bcart\b|بالسلة|للسلة|عالسلة|بالكارت|للكارت/i.test(text)) return false;
  return isExecuteCreateProduct(text);
}

/** Follow-up that is only a bare product name must not swallow how-to questions. */
export function looksLikeDraftFieldReply(text: string): boolean {
  const q = text.trim();
  if (!q || isGuideIntent(q) || isCreateProductRequest(q)) return false;
  if (isConfirmUtterance(q) || isCancelUtterance(q)) return false;
  return true;
}

/** Unquoted name body: letters/digits/Arabic/spaces and light punctuation (not commas). */
const NAME_BODY = String.raw`[A-Za-z0-9\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF \-_./']{0,120}`;

/**
 * Stop before a *separate* field clause — never before bare words like "with" or "price"
 * that can appear inside a catalog title (e.g. "Coffee with Milk", "… with Price 2026").
 * Price/cost trails require `$` or an explicit is/=/: so years in titles are kept.
 */
const FIELD_EQUAL = String.raw`is|equals?|=|:`;
/** Spoken "name equal …" / "product name …" as well as named / called / name is. */
const NAME_CUE = String.raw`called|named|(?:the\s+)?product\s+name(?:\s+(?:${FIELD_EQUAL}))?|(?:the\s+)?name\s+(?:${FIELD_EQUAL})|(?:the\s+)?name\s*[=:]`;
const BEFORE_FIELD_CLAUSE = String.raw`(?=\s*,\s*|\s+(?:with\s+)?(?:prices?|cost)\s*(?:${FIELD_EQUAL})\s*\$?\d|\s+(?:with\s+)?(?:prices?|cost)\s+\$\s*\d|(?<!\bwith)\s+(?:prices?|cost)\s+\$?\d|\s+(?:three\s+prices|the\s+prices|prices?\s+three|البرايس(?:ز|ات)?\s*الثري|الثري\s*برايس(?:ز|ات)?)\s+(?:(?:${FIELD_EQUAL})\s+)?\d|\s+(?:retail|wholesale|vip|selling(?:\s+price)?|qty|quantity|stock|min(?:imum)?\s*stock|(?:ال)?(?:كيونتيتي|كونتيتي|كوانتيتي))\s+(?:(?:${FIELD_EQUAL})\s+)?\d|\s+(?:barcode)\s*(?:${FIELD_EQUAL})\s*\S|\s+(?:barcode)\s+[A-Za-z0-9]*[\d\-][A-Za-z0-9\-]*\s*$|\s+(?:category)\s*(?:${FIELD_EQUAL})\s*|\s+\$\s*\d|\s+(?:(?:ال)?سعر(?:\s*البيع)?|(?:ال)?سعر\s*التجزئة|كلفة)\s+(?:(?:يساوي|${FIELD_EQUAL})\s+)?\d|\s+(?:كمية|مخزون)\s*(?:(?:${FIELD_EQUAL})\s+)?\d|\s+for\s+\d+(?:\.\d{1,2})?\s+dollars?\b|\s+(?:باركود)\s*(?:${FIELD_EQUAL})\s*\S|\s+(?:فئة|صنف)\s*(?:${FIELD_EQUAL})\s*|$)`;

/**
 * True when the whole utterance is clearly a field assignment (or a lone price amount),
 * not a product name that merely begins with "Stock" / "Price" / etc.
 */
export function isProductFieldOnlyReply(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  // Lone amount → selling price follow-up.
  if (/^\s*\$?\s*\d+(?:\.\d{1,2})?\s*$/.test(q)) return true;
  // price/cost: require `$` or is/=/: before the number (avoids "Price Display" / "Cost Center").
  if (/^(?:prices?|cost|retail|wholesale|vip|selling(?:\s+price)?|سعر|كلفة|الكلفة)\s*(?:is|equals?|=|:)\s*\$?\s*\d/i.test(q)) return true;
  if (/^(?:prices?|cost|سعر|كلفة|الكلفة)\s+\$\s*\d/i.test(q)) return true;
  // Also allow "price 5" / "cost 5" when the remainder is only that number (explicit amount reply).
  if (/^(?:prices?|cost|retail|wholesale|vip|سعر|كلفة|الكلفة)\s+\d+(?:\.\d{1,2})?(?:\s|$)/i.test(q)) return true;
  if (/^(?:qty|quantity|stock|كمية|مخزون|(?:ال)?(?:كيونتيتي|كونتيتي|كوانتيتي))\s*(?:is|equals?|=|:)?\s*\d/i.test(q)) return true;
  if (/^(?:min(?:imum)?\s*stock|حد\s*أدنى)\s*(?:is|=|:)?\s*\d/i.test(q)) return true;
  if (/^(?:barcode|باركود)\s*(?:is|=|:)\s*\S+/i.test(q)) return true;
  // barcode CODE only when the code contains a digit or hyphen (not "Barcode Scanner").
  if (/^(?:barcode|باركود)\s+[A-Za-z0-9]*[\d\-][A-Za-z0-9\-]*\s*$/i.test(q)) return true;
  if (/^(?:category|فئة|صنف)\s*(?:is|=|:)\s*\S+/i.test(q)) return true;
  return false;
}

/** Strip only trailing field-*assignment* clauses; keep words like "with" / "Price" in titles. */
function stripTrailingFieldAssignments(name: string): string {
  let out = name;
  const patterns = [
    /\s*,\s*.*$/u, // comma starts a field list ("…, price $5")
    /\s+(?:with\s+)?(?:prices?|cost)\s*(?:is|equals?|=|:)\s*\$?\d.*$/iu,
    /\s+(?:with\s+)?(?:prices?|cost)\s+\$\s*\d.*$/iu,
    /\s+(?<!\bwith\s)(?:prices?|cost)\s+(?:equals?\s+)?\$?\d.*$/iu,
    /\s+(?:three\s+prices|the\s+prices|prices?\s+three|البرايس(?:ز|ات)?\s*الثري|الثري\s*برايس(?:ز|ات)?)\s+\d.*$/iu,
    /\s+(?:retail|wholesale|vip|selling(?:\s+price)?|qty|quantity|stock|min(?:imum)?\s*stock|(?:ال)?(?:كيونتيتي|كونتيتي|كوانتيتي))\s+(?:equals?\s+)?\d.*$/iu,
    /\s+(?:barcode)\s*(?:is|=|:)\s*\S+$/iu,
    /\s+(?:barcode)\s+[A-Za-z0-9]*[\d\-][A-Za-z0-9\-]*\s*$/iu,
    /\s+(?:category)\s*(?:is|=|:)\s*.+$/iu,
    /\s+(?:(?:ال)?سعر(?:\s*البيع)?|(?:ال)?سعر\s*التجزئة|كلفة)\s+\d.*$/iu,
    /\s+(?:سعر|كلفة)\s*(?:is|=|:)\s*\$?\d.*$/iu,
    /\s+(?:سعر|كلفة)\s+\$\s*\d.*$/iu,
    /\s+(?:كمية|مخزون|حد\s*أدنى)\s*(?:is|=|:)?\s*\d.*$/iu,
    /\s+for\s+\d+(?:\.\d{1,2})?\s+dollars?\b.*$/iu,
    /\s+(?:باركود)\s*(?:is|=|:)\s*\S+$/iu,
    /\s+(?:فئة|صنف)\s*(?:is|=|:)\s*.+$/iu,
  ];
  for (const re of patterns) {
    out = out.replace(re, '').trim();
  }
  return out;
}

/**
 * Strip quotes and trailing field assignments; reject create-command residue.
 * Returns null when the capture is not a usable product name (caller should ask).
 */
export function cleanExtractedProductName(raw: string): string | null {
  let name = raw.trim().replace(/^["«”]+|["»“]+$/g, '').trim();
  name = stripTrailingFieldAssignments(name);
  // Drop a trailing sentence period from short create phrases ("جديد.") without
  // stripping periods that belong inside richer names (e.g. "v2.0" keeps inner dots).
  name = name.replace(/[.\u06D4]+$/u, '').trim();
  if (!name) return null;
  // Command leftovers — never treat as the catalog name.
  if (/^(a|an|new|product|item|منتج|مادة|جديد|جديدة)$/i.test(name)) return null;
  if (/^(?:a\s+)?(?:new\s+)?product\.?$/i.test(name)) return null;
  if (/^(?:منتج|مادة)\s*جديد(?:ة)?\.?$/i.test(name)) return null;
  if (/^(?:add|create)\s+(?:a\s+)?(?:new\s+)?product$/i.test(name)) return null;
  if (/^(?:named|called|name\s+is)$/i.test(name)) return null;
  return name.slice(0, 200);
}

/**
 * Extract a product name from free text.
 *
 * Important: do **not** treat a bare `product` / `منتج` token as a name introducer —
 * that silently truncated names containing the word "Product" (C2-Save regression).
 * Prefer `named` / `called` / `name is` / Arabic اسمه, or quoted values.
 * Words like "with" / "price" inside a title are kept unless a real field assignment follows.
 */
export function extractProductName(text: string): string | null {
  const q = text.replace(/\s+/g, ' ').trim();
  if (!q) return null;

  const priced = q.match(/^add\s+(.+?)\s+for\s+\d+(?:\.\d{1,2})?\s+dollars?\b/i);
  if (priced?.[1] && !/^(?:a|an|the)\s+(?:new\s+)?(?:product|item)\b/i.test(priced[1])) {
    return cleanExtractedProductName(priced[1]);
  }

  // 1) Quoted value after an explicit name cue or "add/create product"
  const quoted =
    q.match(new RegExp(String.raw`(?:${NAME_CUE})\s*["«]([^"»]+)["»]`, 'i')) ||
    q.match(/(?:add|create)\s+(?:a\s+)?(?:new\s+)?product\s*["«]([^"»]+)["»]/i) ||
    q.match(/(?:ضيف|أضف)(?:لي|لنا)?\s*(?:منتج|مادة)?\s*["«]([^"»]+)["»]/i);
  if (quoted?.[1]) return cleanExtractedProductName(quoted[1]);

  // 2) Explicit English name cues — never bare "product"
  const explicit = q.match(new RegExp(String.raw`(?:${NAME_CUE})\s+(${NAME_BODY})${BEFORE_FIELD_CLAUSE}`, 'i'));
  if (explicit?.[1]) return cleanExtractedProductName(explicit[1]);

  // 3) Arabic name cues (اسمه / اسمها / اسم المنتج) — stop at comma or valued field labels
  const arabicName = q.match(
    new RegExp(
      String.raw`(?:اسمه|اسمها|الاسم|اسم(?:\s*المنتج)?)\s*(?:هو|يساوي)?\s+([^\n,]+?)${BEFORE_FIELD_CLAUSE}`,
      'i',
    ),
  );
  if (arabicName?.[1]) return cleanExtractedProductName(arabicName[1]);

  // 4) "add/create [a] [new] product <name>" when not followed by named/called/name
  const addProduct = q.match(
    new RegExp(
      String.raw`(?:add|create)\s+(?:a\s+)?(?:new\s+)?product\s+(?!named\b|called\b|name\b)(${NAME_BODY})${BEFORE_FIELD_CLAUSE}`,
      'i',
    ),
  );
  if (addProduct?.[1]) return cleanExtractedProductName(addProduct[1]);

  // 5) Arabic "ضيف/أضف منتج <name>" when not followed by اسمه…
  const arabicAdd = q.match(
    new RegExp(
      String.raw`(?:ضيف|أضف)(?:لي|لنا)?\s*(?:منتج|مادة)\s+(?!اسمه\b|اسمها\b|اسم\b)([^\n,]+?)${BEFORE_FIELD_CLAUSE}`,
      'i',
    ),
  );
  if (arabicAdd?.[1]) return cleanExtractedProductName(arabicAdd[1]);

  return null;
}

/** Pull supported product fields from free text. Does not invent stock or cost. */
export function parseProductDraft(text: string, prior: ProductDraftFields = {}): ProductDraftFields {
  const next: ProductDraftFields = { ...prior };
  const q = text.replace(/\s+/g, ' ').trim();

  // Price/cost: require `$`, is/=/:, a leading comma clause, or a whole-utterance "price 5" reply.
  // Do not treat title words like "Price 2026" inside a name as an amount.
  const money = (raw: string) => Math.round(Number(raw) * 100);
  const wholesale = q.match(
    /(?:wholesale(?:\s+price)?|سعر\s*الجملة|بالجملة|جملة)\s*(?:is|equals?|=|:)?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
  );
  if (wholesale?.[1]) next.wholesaleUsdCents = money(wholesale[1]);
  const vip = q.match(/(?:vip(?:\s+price)?|في\s*اي\s*بي|في\s*آي\s*بي)\s*(?:is|equals?|=|:)?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  if (vip?.[1]) next.vipUsdCents = money(vip[1]);

  const price =
    q.match(/,\s*(?:price|retail|selling(?:\s+price)?|سعر(?:\s*البيع)?|سعر\s*التجزئة|بيعه?)\s*(?:is|=|:)?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/(?:prices?|retail|selling(?:\s+price)?|سعر(?:\s*البيع)?|سعر\s*التجزئة|بيعه?)\s*(?:is|equals?|=|:)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/(?:prices?|retail|selling(?:\s+price)?|سعر(?:\s*البيع)?|سعر\s*التجزئة|بيعه?)\s+\$\s*(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/^(?:prices?|retail|selling(?:\s+price)?|سعر(?:\s*البيع)?|سعر\s*التجزئة|بيعه?)\s+(\d+(?:\.\d{1,2})?)\s*$/i) ||
    q.match(/(?<!\bwith\s)(?:prices?|retail|selling(?:\s+price)?)\s+(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/(?:(?:ال)?سعر(?:\s*البيع)?|(?:ال)?سعر\s*التجزئة|بيعه?)\s*(?:يساوي|equals?)?\s+(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/\$\s*(\d+(?:\.\d{1,2})?)/) ||
    q.match(/(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?|دولار)/i);
  if (price?.[1] && next.retailUsdCents == null) next.retailUsdCents = money(price[1]);

  const triple = q.match(
    /(?:three\s+prices|the\s+prices|prices|prices?\s+three|الأسعار\s+الثلاثة|الاسعار\s+الثلاثة|البرايس(?:ز|ات)?\s*الثري|الثري\s*برايس(?:ز|ات)?)\s*(?:are|equals?|هي|=|:)?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*\$?(?:\s*,\s*|\s+and\s+|\s+و\s+|\s+)\$?\s*(\d+(?:\.\d{1,2})?)\s*\$?(?:\s*,\s*|\s+and\s+|\s+و\s+|\s+)\$?\s*(\d+(?:\.\d{1,2})?)/i,
  );
  if (triple) {
    if (next.retailUsdCents == null) next.retailUsdCents = money(triple[1]!);
    if (next.wholesaleUsdCents == null) next.wholesaleUsdCents = money(triple[2]!);
    if (next.vipUsdCents == null) next.vipUsdCents = money(triple[3]!);
  }

  const cost =
    q.match(/,\s*(?:cost|كلفة|التكلفة|كلفته)\s*(?:is|=|:)?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/(?:cost|كلفة|التكلفة|كلفته)\s*(?:is|=|:)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/(?:cost|كلفة|التكلفة|كلفته)\s+\$\s*(\d+(?:\.\d{1,2})?)/i) ||
    q.match(/^(?:cost|كلفة|التكلفة|كلفته)\s+(\d+(?:\.\d{1,2})?)\s*$/i) ||
    q.match(/(?:cost|كلفة|التكلفة|كلفته)\s+(\d+(?:\.\d{1,2})?)\s*\$/i);
  if (cost?.[1]) next.costUsdCents = money(cost[1]);

  const barcode = q.match(/(?:barcode|بار(?:كود)?|باركود)\s*(?:is|=|:)?\s*([A-Za-z0-9\-]+)/i);
  if (barcode?.[1]) next.barcode = barcode[1];

  const qty = q.match(/(?:qty|quantity|stock|كمية|مخزون|(?:ال)?(?:كيونتيتي|كونتيتي|كوانتيتي))\s*(?:is|equals?|=|:)?\s*(\d+)/i);
  if (qty?.[1]) next.initialStock = Math.max(0, Math.floor(Number(qty[1])));

  const min = q.match(/(?:min(?:imum)?\s*stock|حد\s*أدنى)\s*(?:is|=|:)?\s*(\d+)/i);
  if (min?.[1]) next.minStock = Math.max(0, Math.floor(Number(min[1])));

  const category = q.match(/(?:category|فئة|صنف)\s*(?:is|=|:)?\s*([^\n,]+)/i);
  if (category?.[1]) next.category = category[1].trim();

  const extracted = extractProductName(q);
  if (extracted) {
    next.name = extracted;
  } else if (
    // Whole-utterance name reply / correction (digits allowed; "Product" allowed).
    // Do not invent names from arbitrary create commands — those yield null above and stay missing.
    q.length <= 80 &&
    looksLikeDraftFieldReply(q) &&
    !isProductFieldOnlyReply(q)
  ) {
    const cleaned = cleanExtractedProductName(q);
    if (cleaned) next.name = cleaned;
  }

  // Follow-up that is only a price number
  if (next.retailUsdCents == null && /^\s*\$?\s*\d+(?:\.\d{1,2})?\s*$/.test(q)) {
    next.retailUsdCents = Math.round(Number(q.replace(/[^\d.]/g, '')) * 100);
  }

  return next;
}

export function missingProductFields(draft: ProductDraftFields): ProductDraftMissing[] {
  const missing: ProductDraftMissing[] = [];
  if (!draft.name?.trim()) missing.push('name');
  if (draft.retailUsdCents == null || draft.retailUsdCents < 0) missing.push('retailUsdCents');
  return missing;
}

export function askMissingProductField(missing: ProductDraftMissing, lang: 'ar' | 'en'): string {
  if (missing === 'name') return lang === 'ar' ? 'شو اسم المنتج؟' : 'What is the product name?';
  return lang === 'ar' ? 'كم سعر البيع بالدولار؟' : 'What is the selling price in USD?';
}

function tierPrices(draft: ProductDraftFields, retailUsdCents: number): TierPrices {
  const tier = (cents: number) => ({ usdCents: cents, lbp: null as number | null });
  return {
    retail: tier(retailUsdCents),
    wholesale: tier(draft.wholesaleUsdCents ?? retailUsdCents),
    vip: tier(draft.vipUsdCents ?? retailUsdCents),
  };
}

export function toProductInput(draft: ProductDraftFields): ProductInput | null {
  if (missingProductFields(draft).length > 0) return null;
  const retail = draft.retailUsdCents!;
  return {
    name: draft.name!.trim(),
    category: (draft.category ?? '').trim(),
    barcode: (draft.barcode ?? '').trim(),
    prices: tierPrices(draft, retail),
    costUsdCents: Math.max(0, Math.round(draft.costUsdCents ?? 0)),
    costKnown: draft.costUsdCents != null,
    minStock: draft.minStock ?? null,
    supplierId: null,
    supplierName: '',
    expiryDate: null,
    imeiTracking: false,
    initialStock: Math.max(0, Math.floor(draft.initialStock ?? 0)),
    initialImeis: [],
  };
}

export function formatProductPreview(draft: ProductDraftFields, lang: 'ar' | 'en'): string {
  const price = draft.retailUsdCents != null ? `$${(draft.retailUsdCents / 100).toFixed(2)}` : '—';
  const lines =
    lang === 'ar'
      ? [
          'مسودة منتج — راجع قبل التأكيد:',
          `الاسم: ${draft.name ?? '—'}`,
          `سعر البيع: ${price}`,
          ...(draft.wholesaleUsdCents != null ? [`سعر الجملة: $${(draft.wholesaleUsdCents / 100).toFixed(2)}`] : []),
          ...(draft.vipUsdCents != null ? [`سعر VIP: $${(draft.vipUsdCents / 100).toFixed(2)}`] : []),
          ...(draft.costUsdCents != null
            ? [`الكلفة: $${(draft.costUsdCents / 100).toFixed(2)}`]
            : ['الكلفة: غير مذكورة. هذا ليس تأكيد أن كلفة الشراء $0.00.']),
          ...(draft.barcode?.trim() ? [`الباركود: ${draft.barcode.trim()}`] : []),
          ...(draft.category?.trim() ? [`الفئة: ${draft.category.trim()}`] : []),
          ...(draft.initialStock != null ? [`الكمية الابتدائية: ${draft.initialStock}`] : []),
          'اكتب «تأكيد» للحفظ أو «إلغاء» للإلغاء.',
        ]
      : [
          'Product draft — review before confirming:',
          `Name: ${draft.name ?? '—'}`,
          `Selling price: ${price}`,
          ...(draft.wholesaleUsdCents != null ? [`Wholesale: $${(draft.wholesaleUsdCents / 100).toFixed(2)}`] : []),
          ...(draft.vipUsdCents != null ? [`VIP: $${(draft.vipUsdCents / 100).toFixed(2)}`] : []),
          ...(draft.costUsdCents != null
            ? [`Cost: $${(draft.costUsdCents / 100).toFixed(2)}`]
            : ['Cost: not provided. This is not a $0.00 purchase cost.']),
          ...(draft.barcode?.trim() ? [`Barcode: ${draft.barcode.trim()}`] : []),
          ...(draft.category?.trim() ? [`Category: ${draft.category.trim()}`] : []),
          ...(draft.initialStock != null ? [`Initial quantity: ${draft.initialStock}`] : []),
          'Reply Confirm to save, or Cancel to discard.',
        ];
  return lines.join('\n');
}

/** Shown after save when the draft never stated a purchase cost. The stored number is still 0. */
export function unknownCostSaveNote(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? 'الكلفة غير معروفة. السجل يخزّن $0.00 لأن الحقل لازم يكون رقم. هذا ليس تأكيد أن كلفة الشراء صفر. حساب الربح يعاملها كصفر إلى أن تعدّل الكلفة.'
    : 'Purchase cost was not provided. The record stores $0.00 because the field must be a number. That is not a confirmed purchase cost of zero. Profit calculations treat it as $0.00 until you edit the cost.';
}
