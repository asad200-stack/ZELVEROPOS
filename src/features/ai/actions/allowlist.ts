/**
 * Explicit conversational capabilities. Anything not listed here is unavailable to the AI.
 * Financial settlement / money movement stay forbidden forever in this list.
 */

export const AI_ACTION_ALLOWLIST = [
  'navigate',
  'guide',
  'searchProducts',
  'draftCreateProduct',
  'confirmCreateProduct',
  'cancelPending',
  'cartAdd',
  'cartRemove',
  'cartSetQty',
] as const;

export type AiActionId = (typeof AI_ACTION_ALLOWLIST)[number];

/** Hard refuse — never expose as tools, even with confirmation. */
export const AI_FORBIDDEN_ACTIONS = [
  'checkout',
  'collectPayment',
  'payDebt',
  'processReturn',
  'refund',
  'cashMove',
  'adjustDrawer',
  'adjustCustomerDebt',
  'deleteFinancialRecord',
  'createPurchaseOrder',
  'paySupplier',
  'adjustStock',
] as const;

export type AiForbiddenActionId = (typeof AI_FORBIDDEN_ACTIONS)[number];

/** Back-compat registry name used by existing tests / docs. */
export const AI_TOOLS = AI_ACTION_ALLOWLIST;

export function isAllowedAction(id: string): id is AiActionId {
  return (AI_ACTION_ALLOWLIST as readonly string[]).includes(id);
}

export function isForbiddenAction(id: string): id is AiForbiddenActionId {
  return (AI_FORBIDDEN_ACTIONS as readonly string[]).includes(id);
}
