/**
 * The copilot's only data path: the server-enforced `aiCopilotRead` callable.
 *
 * The server decides the store (the signed-in Super Admin's own internal demo) and refuses
 * everyone else, so the tenant argument the existing interface carries is never sent.
 * Reads only. Catalog-derived answers say when the catalog was capped.
 */
import { DEFAULTS } from '@/constants/app';
import { addDays } from '@/domain/dates';
import { looksLikeCode } from '@/domain/catalogPlan';
import { isLowNotOut } from '@/domain/inventory';
import { nameNormalized } from '@/domain/searchKey';
import type { DailyStats } from '@/services/reportService';
import type { RankSale } from './productRank';
import { AI_LIST_CAP, EXPIRY_SOON_DAYS, type AiReadSource } from './readSnapshot';

export interface CatalogItem {
  id: string;
  name: string;
  barcode: string;
  stock: number;
  minStock: number | null;
  /** Null when the cost is not recorded. Never read as zero. */
  costUsdCents: number | null;
  supplierId: string | null;
  supplierName: string;
  expiryDate: string | null;
}

/** Per-item rule by default; one flat threshold for an explicit "below N" question. */
function isLow(p: Pick<CatalogItem, 'stock' | 'minStock'>, threshold: number, perItem: boolean): boolean {
  return perItem ? isLowNotOut(p, threshold) : p.stock > 0 && p.stock <= threshold;
}

export interface CostedLine {
  productId: string;
  name: string;
  quantity: number;
  returnedQty: number;
  unitUsdCents: number;
  unitLbp: number;
  /** Cost stored on the sale line, or null when none was stored. */
  costUsdCents: number | null;
}

export interface CostedSale {
  id: string;
  soldOn: string;
  currency: 'USD' | 'LBP';
  lines: CostedLine[];
}

export interface PurchaseRow {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;
  totalUsdCents: number;
  returnedUsdCents: number;
  paidUsdCents: number;
  remainingUsdCents: number;
  items: Array<{ productId: string; name: string; quantity: number; unitCostUsdCents: number; returnedQty: number }>;
}

export interface InsightSource extends AiReadSource {
  catalog(): Promise<{ items: CatalogItem[]; complete: boolean }>;
  costedSales(from: string, to: string): Promise<{ sales: CostedSale[]; complete: boolean }>;
  purchases(from: string, to: string): Promise<{ items: PurchaseRow[]; complete: boolean }>;
  suppliers(): Promise<{ items: Array<{ id: string; name: string; balanceUsdCents: number }>; complete: boolean }>;
}

export type AiReadCall = (input: Record<string, unknown>) => Promise<unknown>;

const CATALOG_TTL_MS = 20_000;

export function serverAiReadSource(read: AiReadCall, now: () => number = Date.now): InsightSource {
  let catalogCache: { at: number; value: Promise<{ items: CatalogItem[]; complete: boolean }> } | null = null;
  const salesCache = new Map<string, Promise<{ sales: CostedSale[]; complete: boolean }>>();

  const catalog = () => {
    if (!catalogCache || now() - catalogCache.at > CATALOG_TTL_MS) {
      const value = read({ op: 'catalog' }) as Promise<{ items: CatalogItem[]; complete: boolean }>;
      catalogCache = { at: now(), value };
      value.catch(() => {
        catalogCache = null;
      });
    }
    return catalogCache.value;
  };
  const costedSales = (from: string, to: string) => {
    const key = `${from}|${to}`;
    let hit = salesCache.get(key);
    if (!hit) {
      hit = read({ op: 'saleLines', range: { from, to } }) as Promise<{ sales: CostedSale[]; complete: boolean }>;
      salesCache.set(key, hit);
      hit.catch(() => salesCache.delete(key));
      if (salesCache.size > 8) salesCache.delete(salesCache.keys().next().value!);
    }
    return hit;
  };

  return {
    catalog,
    costedSales,
    purchases: (from, to) => read({ op: 'purchases', range: { from, to } }) as Promise<{ items: PurchaseRow[]; complete: boolean }>,
    suppliers: () => read({ op: 'suppliers' }) as Promise<{ items: Array<{ id: string; name: string; balanceUsdCents: number }>; complete: boolean }>,

    async dailyStats(_tenant, from, to) {
      const result = (await read({ op: 'dailyStats', range: { from, to } })) as { days: DailyStats[] };
      return result.days;
    },
    async cashbox() {
      return (await read({ op: 'cashbox' })) as { usdCents: number; lbp: number };
    },
    async threshold() {
      const result = (await read({ op: 'settings' })) as { lowStockThreshold: number | null };
      return result.lowStockThreshold ?? DEFAULTS.lowStockThreshold;
    },
    async stockCounts(_tenant, threshold, perItem) {
      const { items, complete } = await catalog();
      if (!complete) return null;
      return { low: items.filter((p) => isLow(p, threshold, perItem)).length, out: items.filter((p) => p.stock === 0).length };
    },
    async findStock(_tenant, name) {
      const { items, complete } = await catalog();
      const key = nameNormalized(name);
      const byName = items.filter((p) => nameNormalized(p.name) === key);
      const byCode = looksLikeCode(name) ? items.filter((p) => p.barcode.trim() === name.trim()) : [];
      const chosen = byName.length > 0 ? byName : byCode;
      return { items: chosen.map((p) => ({ id: p.id, name: p.name, stock: p.stock })), complete };
    },
    async products(_tenant, mode, threshold, perItem) {
      const { items, complete } = await catalog();
      const picked = items
        .filter((p) => (mode === 'out' ? p.stock === 0 : isLow(p, threshold, perItem)))
        .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
      return { items: picked.slice(0, 50).map((p) => ({ id: p.id, name: p.name, stock: p.stock })), hasMore: !complete || picked.length > 50 };
    },
    async expiry(_tenant, today) {
      const { items, complete } = await catalog();
      const soonUntil = addDays(today, EXPIRY_SOON_DAYS);
      const dated = items.filter((p) => p.expiryDate);
      const expired = dated.filter((p) => p.expiryDate! < today);
      const soon = dated.filter((p) => p.expiryDate! >= today && p.expiryDate! <= soonUntil);
      const listed = [...expired, ...soon].sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!));
      return {
        expired: expired.length,
        soon: soon.length,
        soonDays: EXPIRY_SOON_DAYS,
        listed: listed.slice(0, AI_LIST_CAP).map((p) => ({ name: p.name, expiryDate: p.expiryDate ?? '', stock: p.stock })),
        listIncomplete: !complete || listed.length > AI_LIST_CAP,
      };
    },
    async debts() {
      return (await read({ op: 'debts' })) as { items: { name: string; debtUsdCents: number }[]; hasMore: boolean };
    },
    async saleLines(_tenant, from, to) {
      const { sales, complete } = await costedSales(from, to);
      const plain: RankSale[] = sales.map((s) => ({
        id: s.id,
        soldOn: s.soldOn,
        currency: s.currency,
        lines: s.lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          returnedQty: l.returnedQty,
          unitUsdCents: l.unitUsdCents,
          unitLbp: l.unitLbp,
        })),
      }));
      return { sales: plain, complete };
    },
    async unknownProductCost(_tenant, from, to) {
      // Scoped to the lines actually sold in [from, to] (the sale-time cost snapshot), not the
      // whole catalog — a product with no recorded cost that was not sold in this range should
      // not block a profit answer for it.
      const { sales, complete } = await costedSales(from, to);
      return !complete || sales.some((s) => s.lines.some((l) => l.costUsdCents === null));
    },
    async productsByIds(_tenant, ids) {
      const { items } = await catalog();
      const wanted = new Set(ids);
      return items.filter((p) => wanted.has(p.id)).map((p) => ({ id: p.id, status: 'active' as const }));
    },
  };
}
