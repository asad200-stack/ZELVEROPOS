/**
 * Firestore reads the POS screens already use.
 * The signed-in rules still apply. This file has no sale, stock, or cash write.
 */
import { getDoc, where } from 'firebase/firestore';
import { addDays } from '@/domain/dates';
import { emptyProductQuery, looksLikeCode } from '@/domain/catalogPlan';
import { nameNormalized } from '@/domain/searchKey';
import { countWhere, getProductsByIds, pageCustomers, pageProducts } from '@/services/catalogQuery';
import { paths, toCashbox, toSettings } from '@/services/db';
import { loadDailyStats } from '@/services/reportService';
import { catalogHasUnknownCost } from '@/services/productService';
import { listSales, type SalesCursor } from '@/services/salesService';
import type { RankSale } from './productRank';
import { AI_LIST_CAP, EXPIRY_SOON_DAYS, type AiReadSource } from './readSnapshot';

/** Eight pages of the sales history page size. A later page means the ranking is not shown. */
const RANK_PAGE_CAP = 8;

export function firestoreAiReadSource(): AiReadSource {
  return {
    dailyStats: (tenantId, from, to) => loadDailyStats(tenantId, from, to),
    async cashbox(tenantId) {
      const snap = await getDoc(paths.cashbox(tenantId));
      const box = toCashbox(snap.data());
      return { usdCents: box.usdCents, lbp: box.lbp };
    },
    async threshold(tenantId) {
      const snap = await getDoc(paths.settings(tenantId));
      return toSettings(snap.data()).lowStockThreshold;
    },
    async stockCounts(tenantId, threshold) {
      const [low, out] = await Promise.all([
        countWhere(tenantId, 'products', [where('status', '==', 'active'), where('stock', '>', 0), where('stock', '<=', threshold)]),
        countWhere(tenantId, 'products', [where('status', '==', 'active'), where('stock', '==', 0)]),
      ]);
      return { low, out };
    },
    async findStock(tenantId, name) {
      const page = await pageProducts(tenantId, emptyProductQuery({ search: name }), null);
      const key = nameNormalized(name);
      const byName = page.items.filter((item) => item.status === 'active' && nameNormalized(item.name) === key);
      const byCode = looksLikeCode(name)
        ? page.items.filter((item) => item.status === 'active' && item.barcode.trim() === name.trim())
        : [];
      const chosen = byName.length > 0 ? byName : byCode;
      return {
        items: chosen.map((item) => ({ id: item.id, name: item.name, stock: item.stock })),
        complete: !page.hasMore,
      };
    },
    async products(tenantId, mode, threshold) {
      const page = await pageProducts(tenantId, emptyProductQuery({ mode, lowStockAt: threshold }), null);
      return {
        items: page.items.map((item) => ({ id: item.id, name: item.name, stock: item.stock })),
        hasMore: page.hasMore,
      };
    },
    async expiry(tenantId, today) {
      const soonUntil = addDays(today, EXPIRY_SOON_DAYS);
      const yesterday = addDays(today, -1);
      const [expired, soon, page] = await Promise.all([
        countWhere(tenantId, 'products', [where('expiryDate', '>=', '0000-01-01'), where('expiryDate', '<=', yesterday)]),
        countWhere(tenantId, 'products', [where('expiryDate', '>=', today), where('expiryDate', '<=', soonUntil)]),
        pageProducts(tenantId, emptyProductQuery({ mode: 'expiry', expiryFrom: '0000-01-01', expiryTo: soonUntil }), null),
      ]);
      return {
        expired,
        soon,
        soonDays: EXPIRY_SOON_DAYS,
        listed: page.items.slice(0, AI_LIST_CAP).map((item) => ({
          name: item.name,
          expiryDate: item.expiryDate ?? '',
          stock: item.stock,
        })),
        listIncomplete: page.hasMore || page.items.length > AI_LIST_CAP,
      };
    },
    async debts(tenantId) {
      const page = await pageCustomers(tenantId, { search: '', debtOnly: true }, null);
      return {
        items: page.items.map((item) => ({ name: item.name, debtUsdCents: item.debtUsdCents })),
        hasMore: page.hasMore,
      };
    },
    saleLines: (tenantId, from, to) => loadRankSales(tenantId, from, to),
    unknownProductCost: (tenantId) => catalogHasUnknownCost(tenantId),
    async productsByIds(tenantId, ids) {
      const unique = [...new Set(ids.filter(Boolean))].slice(0, 40);
      const found = await getProductsByIds(tenantId, unique);
      return found.map((item) => ({ id: item.id, status: item.status }));
    },
  };
}

async function loadRankSales(tenantId: string, from: string, to: string): Promise<{ sales: RankSale[]; complete: boolean }> {
  const sales: RankSale[] = [];
  const seen = new Set<string>();
  let cursor: SalesCursor | null = null;
  for (let page = 0; page < RANK_PAGE_CAP; page += 1) {
    const result = await listSales(tenantId, { from, to, kind: 'all' }, cursor);
    for (const sale of result.items) {
      if (seen.has(sale.id)) continue;
      seen.add(sale.id);
      sales.push({
        id: sale.id,
        soldOn: sale.localDate,
        currency: sale.currency,
        lines: sale.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          returnedQty: item.returnedQty,
          unitUsdCents: item.unitUsdCents,
          unitLbp: item.unitLbp,
        })),
      });
    }
    if (!result.hasMore || !result.cursor) return { sales, complete: true };
    cursor = result.cursor;
  }
  return { sales, complete: false };
}
