import { getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { DAILY_STATS_LIMIT } from '@/domain/salesPlan';
import { paths } from './db';

/** Per-day aggregates maintained atomically with every sale/return/expense (cheap dashboards). */
export interface DailyStats {
  date: string;
  salesCount: number;
  revenueUsdCents: number;
  costUsdCents: number;
  discountUsdCents: number;
  cashSalesUsdCents: number;
  creditSalesUsdCents: number;
  debtCollectedUsdCents: number;
  creditIssuedUsdCents: number;
  returnsCount: number;
  returnsUsdCents: number;
  returnsCostUsdCents: number;
  expensesUsdCents: number;
}

const FIELDS: (keyof Omit<DailyStats, 'date'>)[] = [
  'salesCount',
  'revenueUsdCents',
  'costUsdCents',
  'discountUsdCents',
  'cashSalesUsdCents',
  'creditSalesUsdCents',
  'debtCollectedUsdCents',
  'creditIssuedUsdCents',
  'returnsCount',
  'returnsUsdCents',
  'returnsCostUsdCents',
  'expensesUsdCents',
];

export function emptyStats(date = ''): DailyStats {
  const s = { date } as DailyStats;
  for (const f of FIELDS) s[f] = 0;
  return s;
}

export async function loadDailyStats(tenantId: string, from: string, to: string): Promise<DailyStats[]> {
  const snap = await getDocs(
    query(
      paths.col(tenantId, 'dailyStats'),
      where('date', '>=', from),
      where('date', '<=', to),
      orderBy('date', 'asc'),
      limit(DAILY_STATS_LIMIT),
    ),
  );
  return snap.docs
    .map((d) => {
      const data = d.data();
      const s = emptyStats(String(data.date ?? d.id));
      for (const f of FIELDS) s[f] = typeof data[f] === 'number' ? data[f] : 0;
      return s;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function sumStats(days: DailyStats[]): DailyStats {
  const total = emptyStats('total');
  for (const d of days) for (const f of FIELDS) total[f] += d[f];
  return total;
}

/** Net revenue/profit after returns. */
export function netFigures(s: DailyStats) {
  const netRevenue = s.revenueUsdCents - s.returnsUsdCents;
  const netCost = s.costUsdCents - s.returnsCostUsdCents;
  const grossProfit = netRevenue - netCost;
  return { netRevenue, netCost, grossProfit, netProfit: grossProfit - s.expensesUsdCents };
}
