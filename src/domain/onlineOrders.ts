/**
 * Online Store — Milestone B: website orders.
 *
 * Pure rules shared by the POS screen and the Cloud Functions (copied by copy-shared.mjs):
 * order limits, the status machine, which transitions give stock back, and the reference format.
 * Guest checkout only; payment is cash on delivery or pay at pickup — never a card.
 */
import { STORE_PHONE_RE } from './onlineStore';

export const ORDER_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'delivered',
  'cancelled',
  'rejected',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_METHODS = ['delivery', 'pickup'] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

/** Cash on delivery / pay at pickup. Card payment is intentionally not offered. */
export const PAYMENT_METHODS = ['cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_NAME_MAX = 80;
export const ORDER_ADDRESS_MAX = 300;
export const ORDER_NOTE_MAX = 300;
export const ORDER_MAX_LINES = 30;
export const ORDER_MAX_QTY = 99;
export const ORDER_PHONE_RE = STORE_PHONE_RE;

/** Forward flow plus the two terminal exits. Delivered, cancelled and rejected are final. */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinalStatus(s: OrderStatus): boolean {
  return TRANSITIONS[s].length === 0;
}

/** Stock was taken when the order was placed; cancelling or rejecting gives it back once. */
export function restoresStock(from: OrderStatus, to: OrderStatus): boolean {
  return canTransition(from, to) && (to === 'cancelled' || to === 'rejected');
}

/** Human-friendly order number shown to the customer and the cashier, e.g. ZV-000123. */
export function formatOrderRef(seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  return `ZV-${String(n).padStart(6, '0')}`;
}

/** Customers type spaces, dashes and brackets; store and validate digits with an optional leading +. */
export function normalizeOrderPhone(raw: string): string {
  return raw.trim().replace(/[\s().-]/g, '');
}

export interface OrderLineInput {
  productId: string;
  qty: number;
}

/** Merges duplicate products (sums quantities) and keeps first-seen order. */
export function mergeOrderLines(lines: readonly OrderLineInput[]): OrderLineInput[] {
  const out = new Map<string, number>();
  for (const l of lines) out.set(l.productId, (out.get(l.productId) ?? 0) + l.qty);
  return [...out].map(([productId, qty]) => ({ productId, qty }));
}

export type OrderProblem = 'empty' | 'tooManyLines' | 'qty' | 'name' | 'phone' | 'address';

export interface OrderCustomerInput {
  name: string;
  phone: string;
  address: string;
}

/** First problem found in a checkout form, or null when it can be sent. */
export function orderProblem(
  lines: readonly OrderLineInput[],
  customer: OrderCustomerInput,
  fulfillment: FulfillmentMethod,
): OrderProblem | null {
  const merged = mergeOrderLines(lines);
  if (merged.length === 0) return 'empty';
  if (merged.length > ORDER_MAX_LINES) return 'tooManyLines';
  if (merged.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > ORDER_MAX_QTY)) return 'qty';
  const name = customer.name.trim();
  if (name.length < 2 || name.length > ORDER_NAME_MAX) return 'name';
  if (!ORDER_PHONE_RE.test(normalizeOrderPhone(customer.phone))) return 'phone';
  const address = customer.address.trim();
  if (address.length > ORDER_ADDRESS_MAX) return 'address';
  if (fulfillment === 'delivery' && address.length < 5) return 'address';
  return null;
}

export interface OnlineOrderLine {
  productId: string;
  name: string;
  qty: number;
  unitUsdCents: number;
  unitLbp: number;
  lineUsdCents: number;
  lineLbp: number;
}

export interface OnlineOrder {
  id: string;
  ref: string;
  status: OrderStatus;
  fulfillment: FulfillmentMethod;
  payment: PaymentMethod;
  customerName: string;
  customerPhone: string;
  address: string;
  note: string;
  lines: OnlineOrderLine[];
  totalUsdCents: number;
  totalLbp: number;
  createdAtMs: number;
  updatedAtMs: number;
}

/** What the guest sees after placing an order: no internal ids beyond the reference. */
export interface PublicOrderReceipt {
  ref: string;
  status: OrderStatus;
  fulfillment: FulfillmentMethod;
  lines: { name: string; qty: number; lineUsdCents: number; lineLbp: number }[];
  totalUsdCents: number;
  totalLbp: number;
}

export function toReceipt(o: Pick<OnlineOrder, 'ref' | 'status' | 'fulfillment' | 'lines' | 'totalUsdCents' | 'totalLbp'>): PublicOrderReceipt {
  return {
    ref: o.ref,
    status: o.status,
    fulfillment: o.fulfillment,
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, lineUsdCents: l.lineUsdCents, lineLbp: l.lineLbp })),
    totalUsdCents: o.totalUsdCents,
    totalLbp: o.totalLbp,
  };
}

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Defensive read of a stored order document. */
export function toOnlineOrder(id: string, d: Record<string, unknown> | undefined): OnlineOrder {
  const data = d ?? {};
  const rawLines = Array.isArray(data.lines) ? (data.lines as unknown[]) : [];
  return {
    id,
    ref: str(data.ref),
    status: isOneOf(ORDER_STATUSES, data.status) ? data.status : 'pending',
    fulfillment: isOneOf(FULFILLMENT_METHODS, data.fulfillment) ? data.fulfillment : 'pickup',
    payment: 'cod',
    customerName: str(data.customerName),
    customerPhone: str(data.customerPhone),
    address: str(data.address),
    note: str(data.note),
    lines: rawLines.map((raw) => {
      const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      return {
        productId: str(l.productId),
        name: str(l.name),
        qty: num(l.qty),
        unitUsdCents: num(l.unitUsdCents),
        unitLbp: num(l.unitLbp),
        lineUsdCents: num(l.lineUsdCents),
        lineLbp: num(l.lineLbp),
      };
    }),
    totalUsdCents: num(data.totalUsdCents),
    totalLbp: num(data.totalLbp),
    createdAtMs: num(data.createdAtMs),
    updatedAtMs: num(data.updatedAtMs),
  };
}
