/**
 * Structured store facts for Zelvero AI's own reasoning (summaries, advice, focused answers).
 *
 * Every read goes through the same server-enforced source as the rest of the copilot and is
 * permission-checked here first. A part the person may not see, or that failed to load, is left
 * out (null) — it is never replaced by a guess or a zero.
 */
import { addDays, daysUntil, localDate } from '@/domain/dates';
import { netFigures, type DailyStats } from '@/services/reportService';
import type { ReadSession } from '../readSnapshot';
import type { CatalogItem, InsightSource } from '../serverReadSource';
import { aggregateSales, MIN_UNITS_FOR_ESTIMATE, VELOCITY_DAYS } from '../copilot/insights';
import type { PeriodSpec } from '../copilot/memory';

export interface Totals {
  days: number;
  invoices: number;
  netSales: number;
  grossProfit: number | null;
  netProfit: number | null;
  expenses: number;
  returnsCount: number;
  returnsUsd: number;
  discounts: number;
  cashSales: number;
  creditSales: number;
  debtCollected: number;
}

export interface ProductPace {
  item: CatalogItem;
  units: number;
  perDay: number;
  /** Days of stock left at the recent pace, or null when it did not sell. */
  cover: number | null;
  avgPriceCents: number | null;
  marginPct: number | null;
}

export interface Alerts {
  outButSelling: ProductPace[];
  runningOut: ProductPace[];
  expired: CatalogItem[];
  expiringSoon: Array<{ item: CatalogItem; days: number }>;
  deadStock: ProductPace[];
  missingCost: CatalogItem[];
  topMargin: ProductPace[];
  catalogComplete: boolean;
}

export const EXPIRY_WARN_DAYS = 7;
export const RUNNING_OUT_DAYS = 3;

export function sumDays(days: DailyStats[], from: string, to: string, profitAllowed: boolean, unknownCost: boolean): Totals {
  const t: Totals = { days: 0, invoices: 0, netSales: 0, grossProfit: 0, netProfit: 0, expenses: 0, returnsCount: 0, returnsUsd: 0, discounts: 0, cashSales: 0, creditSales: 0, debtCollected: 0 };
  let costsComplete = true;
  let gross = 0;
  let net = 0;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const raw of days) {
    if (raw.date < from || raw.date > to) continue;
    // A stored day may lack a field (older docs, fields added later): missing counts are zero.
    const d: DailyStats = {
      ...raw,
      salesCount: num(raw.salesCount),
      revenueUsdCents: num(raw.revenueUsdCents),
      costUsdCents: num(raw.costUsdCents),
      discountUsdCents: num(raw.discountUsdCents),
      checkoutDiscountUsdCents: num(raw.checkoutDiscountUsdCents),
      cashSalesUsdCents: num(raw.cashSalesUsdCents),
      creditSalesUsdCents: num(raw.creditSalesUsdCents),
      debtCollectedUsdCents: num(raw.debtCollectedUsdCents),
      creditIssuedUsdCents: num(raw.creditIssuedUsdCents),
      returnsCount: num(raw.returnsCount),
      returnsUsdCents: num(raw.returnsUsdCents),
      returnsCostUsdCents: num(raw.returnsCostUsdCents),
      expensesUsdCents: num(raw.expensesUsdCents),
    };
    t.days += 1;
    t.invoices += d.salesCount;
    const f = netFigures(d);
    t.netSales += f.netRevenue;
    gross += f.grossProfit;
    net += f.netProfit;
    t.expenses += d.expensesUsdCents;
    t.returnsCount += d.returnsCount;
    t.returnsUsd += d.returnsUsdCents;
    t.discounts += d.discountUsdCents + d.checkoutDiscountUsdCents;
    t.cashSales += d.cashSalesUsdCents;
    t.creditSales += d.creditSalesUsdCents;
    t.debtCollected += d.debtCollectedUsdCents;
    if (d.costsComplete === false) costsComplete = false;
  }
  const profitOk = profitAllowed && costsComplete && !unknownCost;
  t.grossProfit = profitOk ? gross : null;
  t.netProfit = profitOk ? net : null;
  return t;
}

export function canSales(s: ReadSession): boolean {
  return s.can('canViewReports');
}
export function canProfit(s: ReadSession): boolean {
  return s.can('canViewReports') && s.can('canViewCosts');
}
export function canStock(s: ReadSession): boolean {
  return s.can('canViewProducts') && s.can('canViewSales');
}

/** Daily totals for a period, or null when not permitted / unreadable. */
export async function loadTotals(session: ReadSession, src: InsightSource, period: PeriodSpec): Promise<Totals | null> {
  if (!canSales(session)) return null;
  try {
    const profitAllowed = canProfit(session);
    const [days, unknownCost] = await Promise.all([
      src.dailyStats(session.tenantId, period.from, period.to),
      profitAllowed && src.unknownProductCost ? src.unknownProductCost(session.tenantId, period.from, period.to).catch(() => true) : Promise.resolve(false),
    ]);
    return sumDays(days, period.from, period.to, profitAllowed, unknownCost);
  } catch {
    return null;
  }
}

/** Recent selling pace for every product (last VELOCITY_DAYS days), or null. */
export async function loadPace(session: ReadSession, src: InsightSource, now: Date): Promise<{ rows: ProductPace[]; catalog: CatalogItem[]; complete: boolean } | null> {
  if (!canStock(session)) return null;
  try {
    const today = localDate(now);
    const from = addDays(today, -(VELOCITY_DAYS - 1));
    const [{ sales, complete: salesComplete }, catalog] = await Promise.all([src.costedSales(from, today), src.catalog()]);
    const byId = new Map(catalog.items.map((p) => [p.id, p]));
    const agg = aggregateSales(sales, byId);
    const showCost = session.can('canViewCosts');
    const rows = catalog.items.map<ProductPace>((item) => {
      const s = agg.get(item.id);
      const units = (s?.units ?? 0) + (s?.lbpUnits ?? 0);
      const perDay = units / VELOCITY_DAYS;
      const avgPriceCents = s && s.units > 0 ? Math.round(s.usdRevenue / s.units) : null;
      const marginPct =
        showCost && s && s.units > 0 && s.costVerified && s.usdRevenue > 0 ? Math.round((100 * (s.usdRevenue - s.usdCost)) / s.usdRevenue) : null;
      return { item, units, perDay, cover: perDay > 0 ? item.stock / perDay : null, avgPriceCents, marginPct };
    });
    return { rows, catalog: catalog.items, complete: salesComplete && catalog.complete };
  } catch {
    return null;
  }
}

export function alertsFrom(pace: { rows: ProductPace[]; catalog: CatalogItem[]; complete: boolean }, now: Date, canExpiry: boolean): Alerts {
  const { rows, catalog } = pace;
  const outButSelling = rows.filter((r) => r.item.stock <= 0 && r.units > 0).sort((a, b) => b.perDay - a.perDay);
  const runningOut = rows
    .filter((r) => r.item.stock > 0 && r.units >= MIN_UNITS_FOR_ESTIMATE && r.cover !== null && r.cover <= RUNNING_OUT_DAYS)
    .sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
  const expired: CatalogItem[] = [];
  const expiringSoon: Array<{ item: CatalogItem; days: number }> = [];
  if (canExpiry) {
    for (const item of catalog) {
      if (!item.expiryDate || item.stock <= 0) continue;
      const days = daysUntil(item.expiryDate, now);
      if (days === null) continue;
      if (days < 0) expired.push(item);
      else if (days <= EXPIRY_WARN_DAYS) expiringSoon.push({ item, days });
    }
    expiringSoon.sort((a, b) => a.days - b.days);
  }
  const deadStock = rows.filter((r) => r.item.stock > 0 && r.units === 0).sort((a, b) => b.item.stock - a.item.stock);
  const missingCost = catalog.filter((p) => p.costUsdCents === null);
  const topMargin = rows
    .filter((r) => r.marginPct !== null && r.units >= MIN_UNITS_FOR_ESTIMATE && r.item.stock > 0)
    .sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0));
  return { outButSelling, runningOut, expired, expiringSoon, deadStock, missingCost, topMargin, catalogComplete: pace.complete };
}

export async function loadDebts(session: ReadSession, src: InsightSource): Promise<{ items: Array<{ name: string; debtUsdCents: number }>; hasMore: boolean } | null> {
  if (!session.can('canViewCustomers')) return null;
  try {
    const page = await src.debts(session.tenantId);
    return { items: [...page.items].sort((a, b) => b.debtUsdCents - a.debtUsdCents), hasMore: page.hasMore };
  } catch {
    return null;
  }
}

export async function loadCash(session: ReadSession, src: InsightSource): Promise<{ usdCents: number; lbp: number } | null> {
  if (!session.can('canManageCashDrawer')) return null;
  try {
    return await src.cashbox(session.tenantId);
  } catch {
    return null;
  }
}
