import { describe, expect, it } from 'vitest';
import type { ReadSession } from '../readSnapshot';
import type { CatalogItem, CostedSale, InsightSource, PurchaseRow } from '../serverReadSource';
import { aggregateSales, costIncreases, runInsight, type InsightSpec } from './insights';
import { emptyMemory, rememberInsight } from './memory';
import { planTurn, type TurnPlan } from './orchestrator';

const now = new Date(2026, 9, 26, 12, 0, 0); // 2026-10-26
const owner: ReadSession = { tenantId: 'demo', route: '/', isOwner: true, can: () => true };
const month = { from: '2026-10-01', to: '2026-10-26', label: 'month' };

function item(id: string, patch: Partial<CatalogItem> = {}): CatalogItem {
  return { id, name: id, barcode: '', stock: 0, minStock: null, costUsdCents: 100, supplierId: null, supplierName: '', expiryDate: null, ...patch };
}

function sale(id: string, soldOn: string, lines: Array<[string, number, number, number | null]>, currency: 'USD' | 'LBP' = 'USD'): CostedSale {
  return {
    id,
    soldOn,
    currency,
    lines: lines.map(([productId, quantity, unitUsdCents, costUsdCents]) => ({ productId, name: productId, quantity, returnedQty: 0, unitUsdCents, unitLbp: 0, costUsdCents })),
  };
}

function source(catalog: CatalogItem[], sales: CostedSale[], extra: Partial<InsightSource> = {}): InsightSource & { reads: string[] } {
  const reads: string[] = [];
  const unused = async () => {
    throw new Error('not used');
  };
  return {
    reads,
    catalog: async () => {
      reads.push('catalog');
      return { items: catalog, complete: true };
    },
    costedSales: async (from, to) => {
      reads.push(`sales ${from}..${to}`);
      return { sales: sales.filter((s) => s.soldOn >= from && s.soldOn <= to), complete: true };
    },
    purchases: async () => ({ items: [], complete: true }),
    suppliers: async () => ({ items: [], complete: true }),
    dailyStats: unused,
    cashbox: unused,
    threshold: unused,
    stockCounts: unused,
    findStock: unused,
    products: unused,
    expiry: unused,
    debts: unused,
    saleLines: unused,
    productsByIds: unused,
    ...extra,
  };
}

const spec = (kind: InsightSpec['kind'], limit = 5): InsightSpec => ({ kind, period: month, limit });

describe('profit by product', () => {
  it('ranks by verified profit and never treats a missing or unexplained zero cost as zero', async () => {
    const catalog = [item('Pepsi', { costUsdCents: 60 }), item('Chips', { costUsdCents: 30 }), item('Mystery', { costUsdCents: null })];
    const sales = [
      sale('s1', '2026-10-05', [['Pepsi', 10, 100, 60]]), // profit 400
      sale('s2', '2026-10-06', [['Chips', 20, 80, 30]]), // profit 1000
      sale('s3', '2026-10-07', [['Mystery', 5, 500, null]]), // cost unknown
      sale('s4', '2026-10-08', [['Pepsi', 1, 100, 0]]), // unexplained zero → Pepsi unverified
    ];
    const result = await runInsight(owner, spec('bestProfit'), source(catalog, sales), 'en', now);
    expect(result.text).toContain('1. «Chips» — profit $10.00 USD (62.5%) on $16.00 USD sales, 20 units.');
    expect(result.text).toContain('Profit not verified');
    expect(result.text).toContain('«Mystery»');
    expect(result.text).toContain('«Pepsi»');
    expect(result.text).not.toMatch(/«Mystery» — profit/);
  });

  it('keeps LBP sales out of USD profit and says so', async () => {
    const sales = [sale('s1', '2026-10-05', [['A', 2, 100, 50]]), sale('s2', '2026-10-05', [['A', 3, 0, 50]], 'LBP')];
    const result = await runInsight(owner, spec('bestProfit'), source([item('A', { costUsdCents: 50 })], sales), 'en', now);
    expect(result.text).toContain('profit $1.00 USD');
    expect(result.text).toContain('Sales made in LBP are not included');
  });

  it('requires both sales and cost permissions', async () => {
    const cashier: ReadSession = { ...owner, isOwner: false, can: (p) => p === 'canViewSales' };
    expect((await runInsight(cashier, spec('bestProfit'), source([], []), 'en', now)).status).toBe('denied');
  });
});

describe('velocity: stock-outs, reorder, slow movers', () => {
  // 28 units of A in the window → 1/day; B sells 0.25/day; C never sells.
  const window = Array.from({ length: 28 }, (_, i) => sale(`a${i}`, `2026-10-${String(26 - (i % 26)).padStart(2, '0')}`, [['A', 1, 200, 100]]));
  const sales = [...window, sale('b1', '2026-10-10', [['B', 7, 300, 150]])];
  const catalog = [item('A', { stock: 5, costUsdCents: 100, supplierName: 'Beirut Foods' }), item('B', { stock: 40, costUsdCents: 150 }), item('C', { stock: 12, costUsdCents: null }), item('D', { stock: 0 })];

  it('forecasts a stock-out from observed sales and states the assumptions', async () => {
    const result = await runInsight(owner, spec('stockout'), source(catalog, sales), 'en', now);
    expect(result.text).toContain('1. «A» — 5 left, selling about 1.0/day → about 5 day(s) (around 2026-10-31).');
    expect(result.text).not.toContain('«B» — 40 left');
    expect(result.text).toContain('This is an estimate');
    expect(result.text).toContain('Based on recorded sales from 2026-09-29 to 2026-10-26 (28 days).');
  });

  it('suggests reorder quantities with lead time, cover and safety assumptions', async () => {
    const result = await runInsight(owner, spec('reorder'), source(catalog, sales), 'en', now);
    // A: 1/day × (7 + 14 + 3) = 24 target − 5 stock = 19
    expect(result.text).toContain('1. «A» — order about 19 (stock 5, selling ~1.0/day, supplier Beirut Foods) ≈ $19.00 USD at the recorded cost.');
    expect(result.text).toContain('7-day supplier lead time (not recorded in the POS)');
    expect(result.text).toContain('no open orders are subtracted');
    expect(result.text).not.toContain('«C» — order');
  });

  it('finds dead and slow stock, valuing it only at a recorded cost', async () => {
    const result = await runInsight(owner, spec('slowMovers'), source(catalog, sales), 'en', now);
    expect(result.text).toContain('«C» — 12 in stock, no sales, cost not recorded.');
    expect(result.text).toContain('«B» — 40 in stock, 7 sold (~160 days of stock), $60.00 USD at cost.');
    expect(result.text).toContain('not counted as zero');
  });

  it('hides stock value from users without cost permission', async () => {
    const noCosts: ReadSession = { ...owner, isOwner: false, can: (p) => p !== 'canViewCosts' };
    const result = await runInsight(noCosts, spec('slowMovers'), source(catalog, sales), 'en', now);
    expect(result.text).not.toContain('at cost');
    expect(result.text).not.toContain('$');
  });
});

describe('trends, suppliers, expiry', () => {
  it('reports rising and falling products between equal periods', async () => {
    const sales = [sale('p1', '2026-10-14', [['A', 10, 100, 50], ['B', 2, 100, 50]]), sale('c1', '2026-10-22', [['A', 3, 100, 50], ['B', 9, 100, 50]])];
    const week = { from: '2026-10-20', to: '2026-10-26', label: 'week' };
    const result = await runInsight(owner, { kind: 'trends', period: week, limit: 5 }, source([item('A'), item('B')], sales), 'en', now);
    expect(result.text).toContain('Rising: «B» 2 → 9.');
    expect(result.text).toContain('Falling: «A» 10 → 3.');
  });

  it('summarises supplier spend, balances and cost increases', async () => {
    const purchases: PurchaseRow[] = [
      { id: 'p1', supplierId: 's1', supplierName: 'Beirut Foods', date: '2026-10-02', totalUsdCents: 50_000, returnedUsdCents: 5_000, paidUsdCents: 30_000, remainingUsdCents: 15_000, items: [{ productId: 'A', name: 'Rice 1kg', quantity: 10, unitCostUsdCents: 100, returnedQty: 0 }] },
      { id: 'p2', supplierId: 's1', supplierName: 'Beirut Foods', date: '2026-10-20', totalUsdCents: 20_000, returnedUsdCents: 0, paidUsdCents: 20_000, remainingUsdCents: 0, items: [{ productId: 'A', name: 'Rice 1kg', quantity: 10, unitCostUsdCents: 125, returnedQty: 0 }] },
    ];
    const src = source([], [], {
      purchases: async () => ({ items: purchases, complete: true }),
      suppliers: async () => ({ items: [{ id: 's1', name: 'Beirut Foods', balanceUsdCents: 15_000 }], complete: true }),
    });
    const result = await runInsight(owner, spec('suppliers'), src, 'en', now);
    expect(result.text).toContain('1. Beirut Foods — 2 purchase(s), $650.00 USD after returns, $500.00 USD paid, $150.00 USD still due.');
    expect(result.text).toContain('Open balances owed to suppliers now: Beirut Foods $150.00 USD.');
    expect(result.text).toContain('«Rice 1kg» $1.00 USD → $1.25 USD');
    expect(costIncreases(purchases)).toHaveLength(1);
  });

  it('flags expired stock and stock likely to expire before it sells', async () => {
    const catalog = [
      item('Milk', { stock: 6, expiryDate: '2026-10-20', costUsdCents: 90 }),
      item('Yogurt', { stock: 30, expiryDate: '2026-11-05', costUsdCents: 50 }),
      item('Cheese', { stock: 2, expiryDate: '2026-11-05' }),
    ];
    const sales = Array.from({ length: 14 }, (_, i) => sale(`y${i}`, `2026-10-${String(10 + i).padStart(2, '0')}`, [['Yogurt', 2, 100, 50]]));
    const result = await runInsight(owner, spec('expiryRisk'), source(catalog, sales), 'en', now);
    expect(result.text).toContain('«Milk» — 6 units, expired 2026-10-20 ($5.40 USD at cost).');
    // Yogurt: 28 units / 28 days = 1/day; 10 days left → 10 expected; 30 − 10 = 20 at risk.
    expect(result.text).toContain('«Yogurt» — expires 2026-11-05 (10 days), 30 in stock, about 20 may be left over ($10.00 USD at cost).');
  });

  it('aggregates duplicates once and nets returns', () => {
    const rows = aggregateSales(
      [sale('x', '2026-10-01', [['A', 3, 100, 50]]), sale('x', '2026-10-01', [['A', 3, 100, 50]]), { ...sale('y', '2026-10-01', [['A', 2, 100, 50]]), lines: [{ productId: 'A', name: 'A', quantity: 2, returnedQty: 1, unitUsdCents: 100, unitLbp: 0, costUsdCents: 50 }] }],
      new Map(),
    );
    expect(rows.get('A')).toMatchObject({ units: 4, usdRevenue: 400, usdCost: 200 });
  });
});

describe('planner: insights and follow-ups', () => {
  const plan = (text: string, memory = emptyMemory()): TurnPlan => planTurn({ text, uiLang: 'en', memory, now, hasTenant: true });

  it.each([
    ['which products make the most profit this month?', 'bestProfit', 'en'],
    ['شو أكتر منتج بيربح؟', 'bestProfit', 'ar'],
    ['what should I reorder?', 'reorder', 'en'],
    ['shu lezim otlob?', 'reorder', 'ar'],
    ['what is going to run out soon?', 'stockout', 'en'],
    ['shu ra7 ye5las?', 'stockout', 'ar'],
    ['show me dead stock', 'slowMovers', 'en'],
    ['which products are trending?', 'trends', 'en'],
    ['how much did we spend with suppliers this month?', 'suppliers', 'en'],
    ['شو المشتريات من الموردين هالشهر؟', 'suppliers', 'ar'],
    ['what stock will go to waste before it expires?', 'expiryRisk', 'en'],
  ])('%s → %s', (text, kind, lang) => {
    expect(plan(text)).toMatchObject({ kind: 'insight', lang, spec: { kind } });
  });

  it('keeps how-to questions on the knowledge flow', () => {
    expect(plan('how do I add a supplier?').kind).toBe('pass');
  });

  it('"show me all" and a new period re-run the same insight', () => {
    const first = plan('which products make the most profit this month?');
    if (first.kind !== 'insight') throw new Error('expected insight');
    const memory = rememberInsight(emptyMemory(), first.spec, 'en', '1. «Chips» — profit …');
    expect(plan('show me the details', memory)).toMatchObject({ kind: 'insight', spec: { kind: 'bestProfit', limit: 20 } });
    expect(plan('and last month?', memory)).toMatchObject({ kind: 'insight', spec: { kind: 'bestProfit', period: { label: 'lastMonth' } } });
  });

  it('"how many of the first one do we have?" after an insight checks that product', () => {
    const first = plan('what should I reorder?');
    if (first.kind !== 'insight') throw new Error('expected insight');
    const memory = rememberInsight(emptyMemory(), first.spec, 'en', '1. «Rice 1kg» — order about 19');
    expect(plan('how many of the first one do we have in stock?', memory)).toMatchObject({ kind: 'read', request: { stockName: 'Rice 1kg' } });
  });
});
