/** Detects financial / settlement / stock-write intents the AI must refuse to execute. */

const FINANCE_EXECUTE =
  /\b(checkout|check\s*out|complete\s+(?:the\s+)?sale|confirm\s+(?:the\s+)?sale|take\s+payment|collect\s+payment|receive\s+payment|record\s+payment|pay\s+(?:the\s+)?debt|settle\s+(?:the\s+)?debt|clear\s+(?:this\s+|the\s+)?(?:customer\s+)?debt|wipe\s+(?:the\s+)?debt|zero\s+(?:the\s+)?debt|forgive\s+(?:the\s+)?debt|collect\s+(?:this\s+|the\s+|a\s+)?(?:customer\s+)?debt(?:\s+payment)?|record\s+(?:a\s+|the\s+|this\s+)?(?:customer\s+)?debt(?:\s+payment)?|process\s+(?:the\s+)?return|refund|cash\s*(?:in|out|move)|deposit|withdraw|open\s+(?:the\s+)?drawer\s+and\s+(?:take|put)|adjust\s+(?:the\s+)?(?:cash|drawer|balance|debt)|transfer\s+.+\b(?:usd|lbp|currency|drawer)\b|convert\s+.+\b(?:usd|lbp)\b|apply\s+(?:a\s+)?discount)\b|تمم\s*البيع|أكمل\s*البيع|اقبض|استلم\s*الدفع|سدد\s*الدين|دفّع\s*الدين|امسح\s*(?:ال)?دين|صفّر\s*(?:ال)?دين|شطب\s*(?:ال)?دين|حصّل\s*(?:ال)?دين|ارجع\s*(?:المبلغ|الفلوس)|نفّذ\s*المرتجع|صرف\s*من\s*الصندوق|أدخل\s*للصندوق|حرّك\s*الصندوق|حوّل\s*(?:من\s*)?(?:دولار|ليرة)|طبّق\s*خصم|طبق\s*خصم/i;

const FINANCE_GUIDE_OK =
  /\b(how\s+(?:do|to)|where|what|which|show\s+me|explain|guide|open\s+(?:the\s+)?(?:cash|sales|return)|take\s+me|go\s+to)|كيف|وين|فرجيني|شرح|افتح|شو|ما\s*هي/i;

/** Ability / policy questions about AI doing money work — not live balance reads. */
const CAPABILITY_SUBJECT =
  /\b(?:can|could|will|would|does|do)\s+(?:you|ai|the\s+ai|zelvero(?:\s+ai)?|this\s+(?:chat|assistant))\b|\b(?:is|are)\s+(?:you|ai|the\s+ai)\s+able\b|هل\s*(?:تقدر|فيني|بتقدر|يقدر)|(?:فيني|بتقدر|تقدر|يقدر)(?:\s*(?:الـ?\s*)?(?:ai|الذكاء))?|هل\s*(?:الـ?\s*)?ai|الذكاء\s*الاصطناعي\s*(?:يقدر|بيقدر)/i;

const CAPABILITY_FINANCE =
  /\b(?:move|transfer)\s+cash\b|\bcash\s*(?:in|out|move|transfer)\b|\bcollect\s+(?:a\s+|the\s+)?(?:customer\s+)?debt(?:\s+payment)?\b|\bpay\s+(?:a\s+|the\s+)?(?:supplier|debt|invoice)\b|\brefund\s+(?:a\s+|the\s+)?customer\b|\bcomplete\s+checkout\b|\bcheckout\b|\btake\s+payment\b|\bsettle\s+(?:debt|balance)\b|حرّك\s*(?:ال)?(?:كاش|صندوق|فلوس)|حرك\s*(?:ال)?(?:كاش|صندوق)|إخراج\s*كاش|تحصيل\s*(?:دين|دينو)|(?:تسدد|تسديد|سداد)\s*دين|د(?:فع|يدفع|ادفع)\s*(?:لل)?مورد|ارجع\s*(?:لل)?زبون|استرداد|أكمل\s*(?:ال)?دفع|تمم\s*(?:ال)?بيع|اقبض\s*(?:من\s*)?زبون/i;

/** Imperative stock/inventory quantity changes — never a live stock inquiry. */
const STOCK_EXECUTE =
  /\b(?:set|change|adjust|update|fix)\s+(?:the\s+)?(?:stock|inventory|qty|quantity)\b|\bstock\s+(?:of\s+.+?\s+)?(?:to|=)\s*\d+|\b(?:set|put)\s+.+\bstock\s+to\s+\d+|\bmake\s+(?:the\s+)?stock\s+\d+|عدّل\s*(?:ال)?مخزون|غير\s*(?:ال)?مخزون|غيّر\s*(?:ال)?مخزون|حط\s*(?:ال)?مخزون|خلّي\s*(?:ال)?مخزون|صير\s*(?:ال)?مخزون|ارفع\s*(?:ال)?مخزون|نزل\s*(?:ال)?مخزون|خلّص\s*(?:ال)?مخزون/i;

function hasNowForce(text: string): boolean {
  return /\b(now|immediately|go\s+ahead|do\s+it|confirm)\b|هلأ|الآن|نفّذ|أكّد/i.test(text);
}

export function isFinancialExecutionRequest(text: string): boolean {
  const q = text.trim();
  if (!FINANCE_EXECUTE.test(q)) return false;
  // "How do I checkout?" is guidance, not execution.
  if (FINANCE_GUIDE_OK.test(q) && !hasNowForce(q)) {
    return false;
  }
  return true;
}

/**
 * "Can AI move cash?" / "Can you pay a supplier?" — policy refusal, never live figures.
 * Wins over bare execution patterns when the ask is clearly about ability/policy.
 */
export function isFinancialCapabilityQuestion(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  if (!CAPABILITY_SUBJECT.test(q)) return false;
  return CAPABILITY_FINANCE.test(q) || FINANCE_EXECUTE.test(q);
}

/** "Set stock to 50" / "عدّل المخزون" — refuse before any live stock reader. */
export function isStockExecutionRequest(text: string): boolean {
  const q = text.trim();
  if (!q || !STOCK_EXECUTE.test(q)) return false;
  // "How do I adjust stock?" stays a guide; imperatives and "… now" refuse.
  if (FINANCE_GUIDE_OK.test(q) && !hasNowForce(q)) return false;
  return true;
}

/** Any write the assistant must refuse before live readers or guides that would misroute. */
export function isForbiddenWriteRequest(text: string): boolean {
  return isStockExecutionRequest(text) || isFinancialExecutionRequest(text);
}

export function financeRefusalText(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? 'ما بقدر أنفّذ عمليات الدفع أو المرتجع أو الصندوق أو التسوية من هالدردشة. بقدر دِلّك على الصفحة، والخطوة الأخيرة منك بالتطبيق.'
    : 'I cannot complete checkout, payments, returns, cashbox moves, or settlements from this chat. I can open the right page; you finish the money step in the app.';
}

/** Longer capability/policy reply when the user asked what AI is allowed to do with money. */
export function financeCapabilityRefusalText(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? 'لا — Zelvero AI ما بينفّذ عمليات مالية (دفع، تحصيل دين، مرتجع نقدي، حركة صندوق، أو إتمام الدفع). بقدر أشرح الخطوات أو أفتحلك الصفحة المناسبة إذا طلبت، والخطوة المالية بتتم من الشاشة.'
    : 'No — Zelvero AI cannot execute financial operations (checkout, debt collection, cash refunds, cashbox moves, or paying suppliers). I can explain the workflow or open the relevant page if you ask; you complete money steps on-screen.';
}

export function stockRefusalText(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? 'ما بقدر أعدّل المخزون من هالدردشة. عدّل الكمية من شاشة المنتجات (تعديل المخزون) بنفسك.'
    : 'I cannot change product stock from this chat. Use Adjust stock on the Products screen yourself.';
}
