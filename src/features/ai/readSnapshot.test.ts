import { describe, expect, it } from 'vitest';
import { AI_TOOLS, answerQuestion } from './engine';
import { publishedKnowledge } from './catalog';
import { modelRequest } from './localModel';
import { acceptLiveWording, composeLiveAnswer } from './liveWording';
import { classifyRead } from './readIntent';
import { firestoreAiReadSource } from './readSource';
import { loadReadSnapshot, type AiReadSource, type ReadSession } from './readSnapshot';
import type { DailyStats } from '@/services/reportService';

const now = new Date(2026, 9, 26, 0, 30, 0);

function day(patch: Partial<DailyStats> = {}): DailyStats {
  return {
    date: '2026-10-26',
    salesCount: 0,
    revenueUsdCents: 0,
    costUsdCents: 0,
    discountUsdCents: 0,
    cashSalesUsdCents: 0,
    creditSalesUsdCents: 0,
    debtCollectedUsdCents: 0,
    creditIssuedUsdCents: 0,
    returnsCount: 0,
    returnsUsdCents: 0,
    returnsCostUsdCents: 0,
    expensesUsdCents: 0,
    ...patch,
  };
}

function session(
  can: (permission: string) => boolean,
  tenantId = 'demoStore',
  options?: { aiAccess?: boolean },
): ReadSession {
  const aiAccess = options?.aiAccess !== false;
  return {
    tenantId,
    route: '/pos',
    isOwner: can('canViewReports') && can('canManageCashDrawer'),
    can: (permission) => {
      if (permission === 'canUseZelveroAI') return aiAccess;
      return can(permission);
    },
  };
}

const owner = session(() => true);
const cashier = session((permission) => permission === 'canSell');

function source(overrides: Partial<AiReadSource> = {}): { seen: string[]; api: AiReadSource } {
  const seen: string[] = [];
  const api: AiReadSource = {
    async dailyStats(tenantId) {
      seen.push(`stats:${tenantId}`);
      return [day({ salesCount: 2, revenueUsdCents: 15_000 })];
    },
    async cashbox(tenantId) {
      seen.push(`cash:${tenantId}`);
      return { usdCents: 10_000, lbp: 250_000 };
    },
    async products(tenantId) {
      seen.push(`products:${tenantId}`);
      return { items: [{ name: 'Demo phone', stock: 2 }], hasMore: false };
    },
    async threshold(tenantId) {
      seen.push(`threshold:${tenantId}`);
      return 10;
    },
    async expiry(tenantId) {
      seen.push(`expiry:${tenantId}`);
      return { expired: 0, soon: 0, soonDays: 30, listed: [], listIncomplete: false };
    },
    async debts(tenantId) {
      seen.push(`debts:${tenantId}`);
      return { items: [{ name: 'Ali', debtUsdCents: 500 }], hasMore: false };
    },
    ...overrides,
    async stockCounts(tenantId, threshold) {
      seen.push(`counts:${tenantId}:${threshold}`);
      return overrides.stockCounts ? overrides.stockCounts(tenantId, threshold) : null;
    },
    async findStock(tenantId, name) {
      seen.push(`find:${tenantId}:${name}`);
      return overrides.findStock ? overrides.findStock(tenantId, name) : { items: [], complete: true };
    },
    async saleLines(tenantId, from, to) {
      seen.push(`lines:${tenantId}:${from}:${to}`);
      return overrides.saleLines ? overrides.saleLines(tenantId, from, to) : { sales: [], complete: true };
    },
    async productsByIds(tenantId, ids) {
      seen.push(`ids:${tenantId}:${ids.length}`);
      return overrides.productsByIds ? overrides.productsByIds(tenantId, ids) : [];
    },
  };
  return { seen, api };
}

describe('Zelvero AI read-only store data', () => {
  it('rejects live reads before sourcing data when canUseZelveroAI is denied', async () => {
    const { seen, api } = source();
    const noAi = session(() => true, 'demoStore', { aiAccess: false });
    const denied = await loadReadSnapshot(noAi, classifyRead('How much did we sell today?', 'en', now)!, api, now);
    expect(denied.status).toBe('denied');
    expect(denied.consultModel).toBe(false);
    expect(denied.text).toMatch(/do not have permission to use Zelvero AI/i);
    expect(denied.text).not.toContain('$150.00');
    expect(seen).toEqual([]);
  });

  it('allows live reads when AI access is granted, including owners', async () => {
    const withAi = session((permission) => permission === 'canViewReports', 'demoStore', { aiAccess: true });
    const sales = await loadReadSnapshot(withAi, classifyRead('How much did we sell today?', 'en', now)!, source().api, now);
    expect(sales.status).toBe('ok');
    expect(sales.text).toContain('$150.00 USD');

    const ownerRead = await loadReadSnapshot(owner, classifyRead('How much did we sell today?', 'en', now)!, source().api, now);
    expect(ownerRead.status).toBe('ok');
  });

  it('still denies individual POS live topics when AI is allowed but the topic permission is missing', async () => {
    const aiOnlyCashier = session((permission) => permission === 'canSell', 'demoStore', { aiAccess: true });
    const deniedCash = await loadReadSnapshot(aiOnlyCashier, classifyRead('How much cash do we have?', 'en', now)!, source().api, now);
    expect(deniedCash.status).toBe('denied');
    expect(deniedCash.text).toContain('Cash drawer');
    expect(deniedCash.text).not.toMatch(/Zelvero AI/i);
  });

  it('lets an owner read today sales in USD and ignores another store name', async () => {
    const { seen, api } = source();
    const request = classifyRead('How much did Second Store sell today?', 'en', now);
    expect(request?.range).toEqual({ from: '2026-10-26', to: '2026-10-26', label: 'today', limited: false });
    const snapshot = await loadReadSnapshot(owner, request!, api, now);
    expect(snapshot.executes).toBe(false);
    expect(snapshot.consultModel).toBe(true);
    expect(snapshot.text).toContain('$150.00 USD');
    expect(snapshot.text).toContain('Invoices: 2');
    expect(snapshot.text).toContain('no LBP total');
    expect(snapshot.text).toContain('signed-in store');
    expect(snapshot.text).not.toContain('Second Store');
    expect(seen).toEqual(['stats:demoStore']);
  });

  it('answers Lebanese and mixed sales questions for the local calendar day', () => {
    const arabic = classifyRead('قديش بعنا اليوم؟', 'en', now);
    expect(arabic?.lang).toBe('ar');
    expect(arabic?.topics).toContain('sales');
    expect(arabic?.range.from).toBe('2026-10-26');
    const late = classifyRead('how much did we sell today?', 'en', new Date(2026, 9, 25, 23, 30, 0));
    expect(late?.range.from).toBe('2026-10-25');
    const early = classifyRead('summarize sales today', 'en', new Date(2026, 9, 26, 0, 0, 0));
    expect(early?.range).toMatchObject({ from: '2026-10-26', to: '2026-10-26' });
    expect(classifyRead('كيف بعمل checkout؟', 'ar', now)).toBeNull();
  });

  it('keeps USD and LBP apart and refuses a cashier the drawer and debts', async () => {
    const { seen, api } = source();
    const cash = await loadReadSnapshot(owner, classifyRead('How much cash do we have in USD and LBP?', 'en', now)!, api, now);
    expect(cash.text).toContain('$100.00 USD');
    expect(cash.text).toContain('250000 LBP');
    expect(cash.text).toContain('were not added together');
    expect(cash.text).not.toMatch(/\$102500|10000250000|combined total/i);

    const deniedCash = await loadReadSnapshot(cashier, classifyRead('How much cash do we have?', 'en', now)!, api, now);
    expect(deniedCash.status).toBe('denied');
    expect(deniedCash.consultModel).toBe(false);
    expect(deniedCash.text).toContain('Cash drawer');
    expect(deniedCash.text).not.toContain('$');
    const deniedDebt = await loadReadSnapshot(cashier, classifyRead('Who owes us money?', 'en', now)!, api, now);
    expect(deniedDebt.text).toContain('Customers & debts');
    expect(deniedDebt.text).not.toContain('Ali');
    expect(seen.filter((item) => item.startsWith('cash:') || item.startsWith('debts:'))).toEqual(['cash:demoStore']);
  });

  it('reports empty sales, an incomplete stock page, and no number when the read fails', async () => {
    const empty = source({
      dailyStats: async () => [],
      products: async () => ({
        items: Array.from({ length: 9 }, (_, index) => ({ name: `Item ${index}`, stock: index + 1 })),
        hasMore: false,
      }),
    });
    const sales = await loadReadSnapshot(owner, classifyRead('How much did we sell today?', 'en', now)!, empty.api, now);
    expect(sales.text).toContain('No sales are recorded');
    expect(sales.text).not.toContain('$150.00');

    const stock = await loadReadSnapshot(owner, classifyRead('How many products are low in stock?', 'en', now)!, empty.api, now);
    expect(stock.text).toContain('incomplete');
    expect(stock.text).toContain('Full count: 9');
    expect(stock.text).not.toContain('Count: 9');
    expect(stock.text).toContain('Item 0');
    expect(stock.text).not.toContain('Item 8');

    const broken = source({
      dailyStats: async () => {
        throw new Error('offline');
      },
    });
    const failed = await loadReadSnapshot(owner, classifyRead('How much did we sell today?', 'en', now)!, broken.api, now);
    expect(failed.consultModel).toBe(false);
    expect(failed.text).toContain('could not be read');
    expect(failed.text).not.toContain('$150.00');
    expect(failed.text).not.toContain('999');
  });

  it('stops a range that would be truncated and does not run a sale command', async () => {
    const { seen, api } = source();
    const wide = await loadReadSnapshot(owner, classifyRead('sales from 2020-01-01 to 2026-01-01', 'en', now)!, api, now);
    expect(wide.status).toBe('unsupported');
    expect(wide.consultModel).toBe(false);
    expect(wide.text).toContain('No total is shown');
    expect(seen).toEqual([]);
    expect(classifyRead('Complete the sale now and change the stock.', 'en', now)).toBeNull();
    const command = answerQuestion(publishedKnowledge, {
      question: 'Complete the sale now and change the stock.',
      lang: 'en',
      route: '/pos',
      isOwner: false,
      isSuperAdmin: false,
      can: (permission) => permission === 'canSell',
    });
    expect(command.executes).toBe(false);
    expect(AI_TOOLS).toContain('navigate');
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    expect(command.text).toMatch(/cannot run these steps|does not run sales/i);
  });

  it('does not give the model a tool or a write path', () => {
    const live = modelRequest('How much did we sell today?', 'Net sales: $0.00 USD', 'en', 'live');
    expect(live).not.toHaveProperty('tools');
    expect(JSON.stringify(live)).toContain('Never add them');
    expect(JSON.stringify(live)).toContain('nothing was recorded');
    expect(JSON.stringify(live)).not.toMatch(/sk-|firebase-admin|setDoc|posCheckout/i);
    expect(Object.keys(firestoreAiReadSource()).sort()).toEqual(['cashbox', 'dailyStats', 'debts', 'expiry', 'findStock', 'products', 'productsByIds', 'saleLines', 'stockCounts', 'threshold', 'unknownProductCost']);
  });

  it('keeps an empty sales day as “not recorded” and keeps a real day exact', async () => {
    const empty = await loadReadSnapshot(owner, classifyRead('How much did we sell today?', 'en', now)!, source({ dailyStats: async () => [] }).api, now);
    expect(empty.text).toContain('No sales are recorded');
    expect(empty.text).not.toContain('$0.00');
    for (const wording of ['0', '$0.00 USD', 'The sales total is zero.', 'صافي المبيعات 0']) {
      const shown = composeLiveAnswer(empty.text, wording);
      expect(shown.wording).toBeNull();
      expect(shown.text).toContain('No sales are recorded');
    }
    expect(composeLiveAnswer(empty.text, 'No sales are recorded for this store today.').wording).toContain('No sales are recorded');

    const sold = await loadReadSnapshot(
      owner,
      classifyRead('Summarize today sales', 'en', now)!,
      source({
        dailyStats: async () => [day({ salesCount: 4, revenueUsdCents: 10_000, returnsCount: 1, returnsUsdCents: 500, costUsdCents: 99_999 })],
      }).api,
      now,
    );
    expect(sold.text).toContain('Invoices: 4');
    expect(sold.text).toContain('Net sales: $95.00 USD');
    expect(sold.text).toContain('Returns: 1, $5.00 USD');
    expect(sold.text).toContain('USD only');
    expect(sold.text).not.toContain('999.99');
    expect(sold.text).not.toContain('Gross profit');
    const revenue = await loadReadSnapshot(
      owner,
      classifyRead('What is my gross and net revenue today?', 'en', now)!,
      source({
        dailyStats: async () => [day({ salesCount: 2, revenueUsdCents: 10_000, returnsCount: 1, returnsUsdCents: 2_000, expensesUsdCents: 500 })],
      }).api,
      now,
    );
    expect(revenue.text).toContain('Gross revenue: $100.00');
    expect(revenue.text).toContain('Net revenue: $80.00');
    expect(revenue.text).toContain('Returns: 1, $20.00');
    const rewritten = composeLiveAnswer(sold.text, 'Net sales were $40.00 USD.');
    expect(rewritten.wording).toBeNull();
    expect(rewritten.text).toContain('$95.00 USD');
  });

  it('answers an Arabic profit question in one readable line when nothing sold', async () => {
    const empty = await loadReadSnapshot(
      owner,
      classifyRead('يعرف قد ايه انا اليوم ربحت؟', 'en', now)!,
      source({ dailyStats: async () => [] }).api,
      now,
    );
    expect(empty.text).toBe('ما في مبيعات ولا مرتجعات ولا مصاريف مسجّلة لليوم، فالربح صفر.');
    expect(empty.text).not.toContain('$');
    expect(empty.consultModel).toBe(false);

    const sold = await loadReadSnapshot(
      owner,
      classifyRead('أنا ربحت اليوم', 'en', now)!,
      source({
        dailyStats: async () => [day({ salesCount: 1, revenueUsdCents: 1_000, costUsdCents: 400, expensesUsdCents: 100 })],
      }).api,
      now,
    );
    expect(sold.text).toBe('ربحك الصافي اليوم $5.00.');
    expect(sold.text).not.toMatch(/فواتير|USD فقط|الربح الإجمالي|من \d{4}/);
    expect(sold.consultModel).toBe(false);
  });

  it('answers a profit question with one net-profit sentence', async () => {
    const request = classifyRead('How much is my profit today?', 'en', now)!;
    expect(request.profitAnswer).toBe('net');
    const sold = await loadReadSnapshot(
      owner,
      request,
      source({
        dailyStats: async () => [day({ salesCount: 3, revenueUsdCents: 30_100, costUsdCents: 8_000, expensesUsdCents: 2_000 })],
      }).api,
      now,
    );
    expect(sold.text).toBe('Your net profit today is $201.00.');
    expect(sold.text).not.toMatch(/Invoice|Currency|from \d{4}|scope|aggregate/i);
    expect(sold.consultModel).toBe(false);

    const gross = await loadReadSnapshot(
      owner,
      classifyRead('What is my gross profit today?', 'en', now)!,
      source({
        dailyStats: async () => [day({ revenueUsdCents: 30_100, costUsdCents: 10_000, expensesUsdCents: 5_000 })],
      }).api,
      now,
    );
    expect(gross.text).toBe('Your gross profit today is $201.00.');
    expect(gross.text).not.toContain('net profit');

    const detail = await loadReadSnapshot(
      owner,
      classifyRead('Give me a profit breakdown for today', 'en', now)!,
      source({
        dailyStats: async () => [day({ revenueUsdCents: 30_100, costUsdCents: 8_000, expensesUsdCents: 2_000 })],
      }).api,
      now,
    );
    expect(detail.text).toBe('Gross profit: $221.00. Recorded expenses: $20.00. Net profit: $201.00.');
    expect(detail.text).not.toMatch(/Invoice|Currency|from \d{4}/);

    const none = await loadReadSnapshot(owner, classifyRead('How much is my profit today?', 'en', now)!, source({ dailyStats: async () => [] }).api, now);
    expect(none.text).toBe('No sales, returns, or expenses are recorded for today, so profit is zero.');

    const missingCost = await loadReadSnapshot(
      owner,
      classifyRead('How much is my profit today?', 'en', now)!,
      source({ dailyStats: async () => [day({ salesCount: 1, revenueUsdCents: 1_000, costsComplete: false })] }).api,
      now,
    );
    expect(missingCost.text).toContain('recorded cost is missing');
    expect(missingCost.text).not.toMatch(/\$\d/);
    expect(missingCost.consultModel).toBe(false);

    const storedZero = await loadReadSnapshot(
      owner,
      classifyRead('How much is my profit today?', 'en', now)!,
      source({
        dailyStats: async () => [day({ salesCount: 1, revenueUsdCents: 1_000, costUsdCents: 0, costsComplete: true })],
        unknownProductCost: async () => true,
      }).api,
      now,
    );
    expect(storedZero.text).toContain('recorded cost is missing');
    expect(storedZero.text).not.toMatch(/\$\d/);

    const zero = await loadReadSnapshot(
      owner,
      classifyRead('How much is my profit today?', 'en', now)!,
      source({
        dailyStats: async () => [day({ salesCount: 1, revenueUsdCents: 500, costUsdCents: 500, returnsCount: 1, returnsUsdCents: 200, returnsCostUsdCents: 200, expensesUsdCents: 0 })],
      }).api,
      now,
    );
    expect(zero.text).toBe('Your net profit today is $0.00.');

    const failed = await loadReadSnapshot(
      owner,
      classifyRead('How much is my profit today?', 'en', now)!,
      source({ dailyStats: async () => { throw new Error('offline'); } }).api,
      now,
    );
    expect(failed.status).toBe('unavailable');
    expect(failed.text).toContain('could not be read');
    expect(failed.text).not.toMatch(/\$\d/);
    expect(failed.consultModel).toBe(false);

    const noCost = session((permission) => permission === 'canViewReports');
    const hidden = await loadReadSnapshot(noCost, classifyRead('How much is my profit today?', 'en', now)!, source().api, now);
    expect(hidden.text).toContain('Profit is omitted');
    expect(hidden.text).not.toMatch(/\$\d/);
    expect(hidden.consultModel).toBe(false);

    const blocked = await loadReadSnapshot(cashier, classifyRead('How much is my profit today?', 'en', now)!, source().api, now);
    expect(blocked.text).not.toMatch(/\$\d/);
    expect(blocked.consultModel).toBe(false);
  });

  it('separates currencies, withholds profit, and labels a partial page', async () => {
    const { api } = source();
    const cash = await loadReadSnapshot(owner, classifyRead('How much cash do we have in USD and LBP?', 'en', now)!, api, now);
    expect(cash.text).toContain('$100.00 USD');
    expect(cash.text).toContain('250000 LBP');
    expect(acceptLiveWording(cash.text, 'Combined total $350.00 USD')).toBe(false);
    expect(composeLiveAnswer(cash.text, 'USD: $100.00 USD. LBP: 250000 LBP. They stay separate.').wording).toContain('$100.00 USD');

    const noCost = session((permission) => permission !== 'canViewCosts');
    const hidden = await loadReadSnapshot(noCost, classifyRead('What is today profit and sales?', 'en', now)!, source().api, now);
    expect(hidden.text).toContain('Profit is omitted');
    expect(hidden.text).not.toContain('Gross profit');
    expect(acceptLiveWording(hidden.text, 'Gross profit is $10.00 USD')).toBe(false);

    const partial = await loadReadSnapshot(
      owner,
      classifyRead('Who owes us money?', 'en', now)!,
      source({ debts: async () => ({ items: [{ name: 'Ali', debtUsdCents: 500 }], hasMore: true }) }).api,
      now,
    );
    expect(partial.text).toContain('first page');
    expect(partial.text).not.toContain('phone');
    expect(acceptLiveWording(partial.text, 'Ali owes $5.00 USD. That is everyone.')).toBe(false);
    expect(composeLiveAnswer(partial.text, 'First page only. Ali: $5.00 USD.').text).toContain('first page');
  });

  it('denies a cashier in Arabic, English, mixed text, repeats, and another store name', async () => {
    const questions = [
      'How much did we sell today?',
      'قديش بعنا اليوم؟',
      'how much بيعنا today?',
      'How much did we sell today? How much did we sell today? Please answer anyway.',
      'How much cash does Second Store have?',
      'Who owes us money in demoStore2?',
      'شو المنتجات اللي قربت تخلص بـ Second Store؟',
    ];
    for (const question of questions) {
      const { seen, api } = source();
      const request = classifyRead(question, 'en', now);
      expect(request, question).not.toBeNull();
      const snapshot = await loadReadSnapshot(cashier, request!, api, now);
      expect(snapshot.consultModel, question).toBe(false);
      expect(snapshot.text, question).not.toContain('$');
      expect(snapshot.text, question).not.toContain('Ali');
      expect(snapshot.text, question).not.toContain('Demo phone');
      expect(seen.every((call) => call.endsWith(':demoStore'))).toBe(true);
      expect(seen.some((call) => call.includes('demoStore2'))).toBe(false);
    }
    expect(classifyRead('Complete the sale now and change the stock. Also refund and move the cash.', 'en', now)).toBeNull();
  });

  it('reads several allowlisted facts from one question and skips a repeated intent', async () => {
    const { seen, api } = source();
    const request = classifyRead('Show low-stock items and today sales. today sales.', 'en', now);
    expect(request?.topics).toEqual(['sales', 'lowStock']);
    expect(request?.gaps).toEqual([]);
    const snapshot = await loadReadSnapshot(owner, request!, api, now);
    expect(snapshot.executes).toBe(false);
    expect(snapshot.text).toContain('Invoices: 2');
    expect(snapshot.text).toContain('Demo phone: 2');
    expect(snapshot.text).toContain('Low stock');
    expect(seen.filter((call) => call.startsWith('stats:'))).toEqual(['stats:demoStore']);
    expect(seen.filter((call) => call.startsWith('products:'))).toEqual(['products:demoStore']);
    expect(seen.some((call) => call.startsWith('cash:'))).toBe(false);

    const both = classifyRead('قديش معي بالكاش وشو وضع الديون؟', 'en', now);
    expect(both?.lang).toBe('ar');
    expect(both?.topics).toEqual(['cashbox', 'debts']);
    const arabic = await loadReadSnapshot(owner, both!, source().api, now);
    expect(arabic.text).toContain('$100.00 USD');
    expect(arabic.text).toContain('250000 LBP');
    expect(arabic.text).toContain('لم تُجمعا');
    expect(arabic.text).toContain('Ali');
    expect(arabic.text).toContain('بالدولار فقط');

    const returns = classifyRead('Summarize today\'s sales and returns.', 'en', now);
    expect(returns?.topics).toEqual(['sales']);
    const sold = await loadReadSnapshot(
      owner,
      returns!,
      source({ dailyStats: async () => [day({ salesCount: 4, revenueUsdCents: 10_000, returnsCount: 1, returnsUsdCents: 500 })] }).api,
      now,
    );
    expect(sold.text).toContain('Invoices: 4');
    expect(sold.text).toContain('Returns: 1, $5.00 USD');
    expect(sold.text).toContain('USD only');
  });

  it('answers the allowed part and withholds the rest', async () => {
    const reportsOnly = session((permission) => permission === 'canViewReports');
    const { seen, api } = source();
    const mixedRequest = classifyRead('Show today sales and the cash drawer', 'en', now);
    expect(mixedRequest?.topics).toEqual(['sales', 'cashbox']);
    const mixed = await loadReadSnapshot(reportsOnly, mixedRequest!, api, now);
    expect(mixed.text).toContain('$150.00 USD');
    expect(mixed.text).toContain('cashbox was not read');
    expect(mixed.text).not.toContain('250000 LBP');
    expect(seen).toEqual(['stats:demoStore']);
    expect(composeLiveAnswer(mixed.text, 'Cash is 250000 LBP and sales are $150.00 USD.').wording).toBeNull();

    const ranked = classifyRead('قديش بعنا اليوم وشو أكتر منتج انباع؟', 'en', now);
    expect(ranked?.topics).toEqual(['sales', 'productRank']);
    expect(ranked?.gaps).toEqual([]);
    const partial = await loadReadSnapshot(owner, ranked!, source({ dailyStats: async () => [] }).api, now);
    expect(partial.text).toContain('لا توجد مبيعات مسجّلة');
    expect(partial.text).toContain('لا توجد وحدات صافية');
    expect(partial.text).not.toContain('«');
    expect(composeLiveAnswer(partial.text, 'Demo phone sold the most.').wording).toBeNull();
    expect(composeLiveAnswer(partial.text, 'لا توجد مبيعات مسجّلة. لا توجد وحدات صافية مباعة في هذه الفترة.').wording).toContain('لا توجد وحدات صافية');

    const quantities = classifyRead('شو المنتجات اللي قربت تخلص وقديش كمية كل وحدة؟', 'en', now);
    expect(quantities?.topics).toEqual(['lowStock']);
    expect(quantities?.gaps).toEqual([]);
    const stock = await loadReadSnapshot(owner, quantities!, source().api, now);
    expect(stock.text).toContain('Demo phone: 2');
    expect(stock.text).not.toContain('كل الأصناف');

    const catalog = classifyRead('قديش كمية كل المنتجات؟', 'en', now);
    expect(catalog?.topics).toEqual([]);
    expect(catalog?.gaps).toEqual(['fullCatalog']);
    const missing = await loadReadSnapshot(owner, catalog!, source().api, now);
    expect(missing.status).toBe('unsupported');
    expect(missing.consultModel).toBe(false);
    expect(missing.text).toContain('لا كل الأصناف');
    expect(missing.text).not.toContain('Demo phone');

    const otherStore = await loadReadSnapshot(cashier, classifyRead('قديش بعنا بـ Second Store وقديش الكاش؟', 'en', now)!, source().api, now);
    expect(otherStore.consultModel).toBe(false);
    expect(otherStore.text).not.toContain('$');
    expect(otherStore.text).toContain('Reports & dashboard figures');
    expect(otherStore.text).toContain('Cash drawer');

    const action = classifyRead('قديش بعنا اليوم وكمّل البيع', 'en', now);
    expect(action?.refusesAction).toBe(true);
    const refused = await loadReadSnapshot(owner, action!, source({ dailyStats: async () => [] }).api, now);
    expect(refused.executes).toBe(false);
    expect(refused.text).toContain('لا تنفّذ هذا الطلب');
    expect(refused.text).toContain('لا توجد مبيعات مسجّلة');
    expect(composeLiveAnswer(refused.text, null).text).toContain('لا توجد مبيعات مسجّلة');
  });
});

describe('verified product rankings', () => {
  const phone = { productId: 'p1', name: 'Demo phone', quantity: 2, returnedQty: 0, unitUsdCents: 1000, unitLbp: 0 };
  const cable = { productId: 'p2', name: 'USB cable', quantity: 5, returnedQty: 2, unitUsdCents: 300, unitLbp: 0 };

  it('ranks net units from sale lines and keeps returns, ties, and duplicate invoices', async () => {
    const early = classifyRead('What were my best-selling products today?', 'en', new Date(2026, 9, 26, 0, 30));
    const previousEvening = classifyRead('What were my best-selling products today?', 'en', new Date(2026, 9, 25, 23, 30));
    expect(early?.rankRange).toEqual({ from: '2026-10-26', to: '2026-10-26', label: 'today', limited: false });
    expect(previousEvening?.rankRange.from).toBe('2026-10-25');
    expect(early?.topics).toEqual(['productRank']);
    expect(early?.rankBy).toBe('units');
    expect(early?.rankLimit).toBe(5);

    const { seen, api } = source({
      saleLines: async () => ({
        sales: [
          { id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [{ ...phone, quantity: 2 }, { ...cable, quantity: 3, returnedQty: 0 }, { productId: 'p3', name: 'Charger', quantity: 1, returnedQty: 1, unitUsdCents: 500, unitLbp: 0 }] },
          { id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [phone] },
          { id: 's2', soldOn: '2026-10-26', currency: 'USD', lines: [{ ...phone, quantity: 2 }] },
          { id: 's3', soldOn: '2026-10-26', currency: 'USD', lines: [{ productId: 'p2', name: 'Old cable', quantity: 1, returnedQty: 0, unitUsdCents: 250, unitLbp: 0 }] },
        ],
        complete: true,
      }),
    });
    const snapshot = await loadReadSnapshot(owner, early!, api, now);
    expect(snapshot.executes).toBe(false);
    expect(snapshot.text).toContain('«Demo phone»: 4 net units');
    expect(snapshot.text).toContain('«USB cable»: 4 net units');
    expect(snapshot.text).toContain('also recorded as Old cable');
    expect(snapshot.text).toContain('Equal net units are a tie');
    expect(snapshot.text).not.toContain('Charger');
    expect(snapshot.text).not.toContain('$');
    expect(snapshot.text).not.toContain('customer');
    expect(snapshot.text).toContain('Every sale in the range was counted');
    expect(seen).toEqual(['lines:demoStore:2026-10-26:2026-10-26']);
    expect(composeLiveAnswer(snapshot.text, null).text).toContain('«Demo phone»: 4 net units');
    expect(composeLiveAnswer(snapshot.text, 'Mystery charger sold the most.').wording).toBeNull();
    expect(composeLiveAnswer(snapshot.text, 'Demo phone sold the most.').wording).toBeNull();
  });

  it('shows an Arabic top 5 for the local week and withholds a partial page', async () => {
    const request = classifyRead('شو أكتر 5 منتجات انباعوا هالأسبوع؟', 'en', now);
    expect(request?.lang).toBe('ar');
    expect(request?.topics).toEqual(['productRank']);
    expect(request?.rankLimit).toBe(5);
    expect(request?.rankRange).toEqual({ from: '2026-10-20', to: '2026-10-26', label: 'week', limited: false });
    const listed = await loadReadSnapshot(owner, request!, source({
      saleLines: async () => ({ sales: [{ id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [phone] }], complete: true }),
    }).api, now);
    expect(listed.text).toContain('«Demo phone»: 2 net units');
    expect(listed.text).toContain('أعلى 1 من 1');

    const incomplete = await loadReadSnapshot(owner, request!, source({
      saleLines: async () => ({ sales: [{ id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [phone] }], complete: false }),
    }).api, now);
    expect(incomplete.text).toContain('ناقصة');
    expect(incomplete.text).toContain('لا يُعرض ترتيب');
    expect(incomplete.text).not.toContain('«');
    expect(incomplete.text).not.toContain('2 net units');
    expect(composeLiveAnswer(incomplete.text, 'Demo phone: 2 net units').wording).toBeNull();
  });

  it('compares two months, ranks revenue in one currency, and stops when currencies differ', async () => {
    const compared = classifyRead('Compare the best-selling products this month with last month.', 'en', now);
    expect(compared?.topics).toEqual(['productRank']);
    expect(compared?.rankRange).toMatchObject({ from: '2026-10-01', to: '2026-10-26', label: 'month' });
    expect(compared?.compareRange).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'lastMonth' });
    const { seen, api } = source({
      saleLines: async (_tenant, from) => ({
        sales: [{
          id: from,
          soldOn: from,
          currency: 'USD' as const,
          lines: [{ ...phone, quantity: from.startsWith('2026-10') ? 4 : 1 }],
        }],
        complete: true,
      }),
    });
    const snapshot = await loadReadSnapshot(owner, compared!, api, now);
    expect(seen).toEqual(['lines:demoStore:2026-10-01:2026-10-26', 'lines:demoStore:2026-09-01:2026-09-30']);
    expect(snapshot.text).toContain('range month');
    expect(snapshot.text).toContain('«Demo phone»: 4 net units');
    expect(snapshot.text).toContain('range lastMonth');
    expect(snapshot.text).toContain('«Demo phone»: 1 net units');

    const revenue = classifyRead('Rank the best-selling products today by revenue', 'en', now);
    expect(revenue?.topics).toEqual(['productRank']);
    expect(revenue?.rankBy).toBe('revenue');
    const usd = await loadReadSnapshot(owner, revenue!, source({
      saleLines: async () => ({
        sales: [{
          id: 's1',
          soldOn: '2026-10-26',
          currency: 'USD',
          lines: [{ ...phone, quantity: 4, unitUsdCents: 100 }, { ...cable, quantity: 1, returnedQty: 0, unitUsdCents: 2000 }],
        }],
        complete: true,
      }),
    }).api, now);
    expect(usd.text).toContain('Ranked by net USD');
    expect(usd.text).toContain('LBP is not included');
    expect(usd.text).not.toMatch(/\d[\d,]* LBP/);
    expect(usd.text.indexOf('USB cable')).toBeLessThan(usd.text.indexOf('Demo phone'));
    expect(composeLiveAnswer(usd.text, 'USB cable sold the most.').wording).toContain('USB cable');
    expect(composeLiveAnswer(usd.text, 'Demo phone sold the most.').wording).toBeNull();

    const mixed = await loadReadSnapshot(owner, revenue!, source({
      saleLines: async () => ({
        sales: [
          { id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [phone] },
          { id: 's2', soldOn: '2026-10-26', currency: 'LBP', lines: [{ ...cable, unitLbp: 50000, quantity: 9, returnedQty: 0 }] },
        ],
        complete: true,
      }),
    }).api, now);
    expect(mixed.text).toContain('No ranking is shown');
    expect(mixed.text).toContain('not combined');
    expect(mixed.text).not.toContain('«');
  });

  it('keeps each permission independent and ignores another store name', async () => {
    const question = 'Show today sales and the best-selling products';
    const reportsOnly = session((permission) => permission === 'canViewReports');
    const salesOnly = session((permission) => permission === 'canViewSales');
    const reports = await loadReadSnapshot(reportsOnly, classifyRead(question, 'en', now)!, source().api, now);
    expect(reports.text).toContain('$150.00 USD');
    expect(reports.text).toContain('productRank was not read');
    expect(reports.text).toContain('View sales & returns');
    expect(reports.text).not.toContain('«');

    const { seen, api } = source({
      saleLines: async () => ({ sales: [{ id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [phone] }], complete: true }),
    });
    const lines = await loadReadSnapshot(salesOnly, classifyRead('Show today sales and the best-selling products at Second Store', 'en', now)!, api, now);
    expect(lines.text).toContain('«Demo phone»: 2 net units');
    expect(lines.text).toContain('sales was not read');
    expect(lines.text).not.toContain('$150.00');
    expect(lines.text).not.toContain('Second Store');
    expect(seen).toEqual(['lines:demoStore:2026-10-26:2026-10-26']);

    const cashierRank = await loadReadSnapshot(cashier, classifyRead('best-selling products today at Second Store', 'en', now)!, source().api, now);
    expect(cashierRank.status).toBe('denied');
    expect(cashierRank.consultModel).toBe(false);
    expect(cashierRank.text).not.toContain('«');
    expect(cashierRank.text).not.toContain('2 net units');

    const both = classifyRead('Show low-stock items and the best-selling products today', 'en', now);
    expect(both?.topics).toEqual(['productRank', 'lowStock']);
    const { seen: calls, api: mixed } = source({
      saleLines: async () => ({ sales: [{ id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [cable] }], complete: true }),
    });
    const snapshot = await loadReadSnapshot(owner, both!, mixed, now);
    expect(snapshot.text).toContain('Demo phone: 2');
    expect(snapshot.text).toContain('«USB cable»: 3 net units');
    expect(calls).toEqual(['lines:demoStore:2026-10-26:2026-10-26', 'threshold:demoStore', 'products:demoStore', 'counts:demoStore:10']);
  });

  it('does not list every product when the completed scan is too long, and a failed read invents nothing', async () => {
    const each = classifyRead('How many units of each product did we sell yesterday?', 'en', now);
    expect(each?.topics).toEqual(['productRank']);
    expect(each?.rankLimit).toBe('all');
    expect(each?.rankRange).toEqual({ from: '2026-10-25', to: '2026-10-25', label: 'yesterday', limited: false });
    const sales = Array.from({ length: 21 }, (_, index) => ({
      id: `s${index}`,
      soldOn: '2026-10-25',
      currency: 'USD' as const,
      lines: [{ productId: `p${index}`, name: `Item ${index}`, quantity: index + 1, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 }],
    }));
    const tooMany = await loadReadSnapshot(owner, each!, source({ saleLines: async () => ({ sales, complete: true }) }).api, now);
    expect(tooMany.text).toContain('incomplete');
    expect(tooMany.text).toContain('No ranking is shown');
    expect(tooMany.text).not.toContain('«');

    const wide = await loadReadSnapshot(owner, classifyRead('best-selling products from 2020-01-01 to 2026-01-01', 'en', now)!, source().api, now);
    expect(wide.text).toContain('No ranking is shown');
    expect(wide.text).not.toContain('«');

    const failed = await loadReadSnapshot(owner, classifyRead('best-selling products today', 'en', now)!, source({
      saleLines: async () => { throw new Error('blocked'); },
    }).api, now);
    expect(failed.status).toBe('unavailable');
    expect(failed.consultModel).toBe(false);
    expect(failed.text).toContain('productRank could not be read');
    expect(failed.text).not.toContain('«');
    expect(composeLiveAnswer(failed.text, 'Demo phone: 4 net units').wording).toBeNull();
  });
});

describe('inventory questions', () => {
  it('reads one product, refuses a duplicate name, and answers a quantity from current stock', async () => {
    const lookup = classifyRead('How many Demo phone do we have in Second Store?', 'en', now);
    expect(lookup?.topics).toEqual(['stockItem']);
    expect(lookup?.stockName).toBe('Demo phone');
    expect(lookup?.stockQty).toBeNull();
    const { seen, api } = source({
      findStock: async () => ({ items: [{ id: 'p1', name: 'Demo phone', stock: 2 }], complete: true }),
    });
    const snapshot = await loadReadSnapshot(owner, lookup!, api, now);
    expect(seen).toEqual(['find:demoStore:Demo phone']);
    expect(snapshot.text).toContain('«Demo phone»: 2 on hand');
    expect(snapshot.text).toContain('not quantity sold');
    expect(snapshot.text).not.toContain('Second Store');
    expect(composeLiveAnswer(snapshot.text, 'Mystery charger: 9 on hand.').wording).toBeNull();
    expect(composeLiveAnswer(snapshot.text, 'Demo phone sold 2.').wording).toBeNull();
    expect(composeLiveAnswer(snapshot.text, null).text).toContain('2 on hand');

    const ask = classifyRead('do we have 5 of Demo phone?', 'en', now);
    expect(ask?.stockQty).toBe(5);
    const answer = await loadReadSnapshot(owner, ask!, source({
      findStock: async () => ({ items: [{ id: 'p1', name: 'Demo phone', stock: 2 }], complete: true }),
    }).api, now);
    expect(answer.text).toContain('Requested 5');
    expect(answer.text).toContain('Available: no');
    expect(answer.text).toContain('2 on hand');

    const none = await loadReadSnapshot(owner, classifyRead('stock of Missing cable', 'en', now)!, source().api, now);
    expect(none.text).toContain('No active product has that exact name');
    expect(none.text).not.toContain('on hand.');

    const copies = await loadReadSnapshot(owner, classifyRead('stock of USB cable', 'en', now)!, source({
      findStock: async () => ({
        items: [
          { id: 'a1', name: 'USB cable', stock: 4 },
          { id: 'a2', name: 'USB cable', stock: 0 },
        ],
        complete: true,
      }),
    }).api, now);
    expect(copies.text).toContain('not unique');
    expect(copies.text).toContain('a1: 4 on hand');
    expect(copies.text).toContain('a2: 0 on hand');
    expect(copies.text).toContain('availability is not answered');
    expect(composeLiveAnswer(copies.text, 'Available: yes. USB cable: 4 on hand.').wording).toBeNull();

    const unfinished = await loadReadSnapshot(owner, classifyRead('stock of USB cable', 'en', now)!, source({
      findStock: async () => ({ items: [{ id: 'a1', name: 'USB cable', stock: 4 }], complete: false }),
    }).api, now);
    expect(unfinished.text).toContain('did not finish');
    expect(unfinished.text).toContain('No stock figure is shown');
    expect(unfinished.text).not.toContain('4 on hand');
  });

  it('counts low stock and zero stock separately and keeps a partial name list incomplete', async () => {
    const both = classifyRead('how many products are low in stock and how many are out of stock?', 'en', now);
    expect(both?.topics).toEqual(['lowStock', 'outOfStock']);
    expect(both?.stockName).toBeNull();
    const { seen, api } = source({
      stockCounts: async () => ({ low: 2, out: 1 }),
      products: async (_tenant, mode) => mode === 'low'
        ? { items: [{ name: 'Demo phone', stock: 2 }, { name: 'Last charger', stock: 1 }], hasMore: false }
        : { items: [{ name: 'Empty case', stock: 0 }], hasMore: false },
    });
    const snapshot = await loadReadSnapshot(owner, both!, api, now);
    expect(snapshot.text).toContain('Full count: 2');
    expect(snapshot.text).toContain('Full count: 1');
    expect(snapshot.text).toContain('Demo phone: 2');
    expect(snapshot.text).toContain('Empty case: 0');
    expect(snapshot.text).toContain('store setting');
    expect(snapshot.text).toContain('not quantity sold');
    expect(snapshot.text).toContain('The names shown are the whole result');
    expect(seen.filter((call) => call.startsWith('counts:'))).toEqual(['counts:demoStore:10', 'counts:demoStore:0']);

    const below = classifyRead('products below 5', 'en', now);
    expect(below?.stockBelow).toBe(4);
    expect(below?.topics).toEqual(['lowStock']);
    const custom = await loadReadSnapshot(owner, below!, source({
      stockCounts: async () => ({ low: 1, out: 0 }),
      products: async () => ({ items: [{ name: 'Last charger', stock: 1 }], hasMore: false }),
    }).api, now);
    expect(custom.text).toContain('Below 5');
    expect(custom.text).toContain('1 through 4');
    expect(custom.text).not.toContain('store setting');

    expect(classifyRead('كم في USB cable؟', 'en', now)?.stockName).toBe('USB cable');
    const arabic = classifyRead('قديش في عندنا من الشاحن؟', 'en', now);
    expect(arabic?.lang).toBe('ar');
    expect(arabic?.topics).toEqual(['stockItem']);
    expect(arabic?.stockName).toBe('الشاحن');
    const ar = await loadReadSnapshot(owner, arabic!, source({
      findStock: async () => ({ items: [], complete: true }),
    }).api, now);
    expect(ar.text).toContain('«الشاحن»');
    expect(ar.text).toContain('لا يوجد منتج نشط');

    const page = await loadReadSnapshot(owner, classifyRead('which products are out of stock?', 'en', now)!, source({
      stockCounts: async () => null,
      products: async () => ({ items: [{ name: 'Empty case', stock: 0 }], hasMore: true }),
    }).api, now);
    expect(page.text).toContain('The full count was not read');
    expect(page.text).toContain('incomplete');
    expect(page.text).not.toContain('Full count:');
    expect(page.text).not.toContain('the whole result');

    const cashierList = await loadReadSnapshot(cashier, classifyRead('how many products are low in stock?', 'en', now)!, source().api, now);
    expect(cashierList.text).toContain('lowStock was not read');
    expect(cashierList.text).not.toContain('Demo phone');
    const cashierItem = await loadReadSnapshot(cashier, classifyRead('stock of Demo phone', 'en', now)!, source({
      findStock: async () => ({ items: [{ id: 'p1', name: 'Demo phone', stock: 2 }], complete: true }),
    }).api, now);
    expect(cashierItem.text).toContain('2 on hand');
    const stranger = session(() => false);
    const denied = await loadReadSnapshot(stranger, classifyRead('stock of Demo phone at Second Store', 'en', now)!, source().api, now);
    expect(denied.status).toBe('denied');
    expect(denied.consultModel).toBe(false);
    expect(denied.text).not.toContain('on hand');
    expect(denied.text).toMatch(/View products[\s\S]*Sell \(point of sale\)/);
  });
});

describe('low stock with posted sales', () => {
  const held = [
    { id: 'phone', name: 'Demo phone', stock: 2 },
    { id: 'charger', name: 'Last charger', stock: 1 },
  ];
  const posted = {
    sales: [
      {
        id: 's1',
        soldOn: '2026-10-26',
        currency: 'USD' as const,
        lines: [
          { productId: 'phone', name: 'Old phone', quantity: 4, returnedQty: 1, unitUsdCents: 100, unitLbp: 0 },
          { productId: 'gone', name: 'Retired cable', quantity: 2, returnedQty: 0, unitUsdCents: 50, unitLbp: 9000 },
          { productId: 'old', name: 'Archived case', quantity: 2, returnedQty: 0, unitUsdCents: 50, unitLbp: 0 },
          { productId: 'healthy', name: 'Phone case', quantity: 8, returnedQty: 0, unitUsdCents: 50, unitLbp: 0 },
        ],
      },
      {
        id: 's1',
        soldOn: '2026-10-26',
        currency: 'USD' as const,
        lines: [{ productId: 'phone', name: 'Demo phone', quantity: 9, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 }],
      },
    ],
    complete: true,
  };

  it('lists on-hand stock beside net units and omits a low-stock product that did not sell', async () => {
    const separate = classifyRead('Show low-stock items and the best-selling products today', 'en', now);
    expect(separate?.topics).toEqual(['productRank', 'lowStock']);
    expect(separate?.stockSales).toBeNull();

    const request = classifyRead('Which low-stock products had the highest net units sold today at Second Store?', 'en', now);
    expect(request?.topics).toEqual(['stockSales']);
    expect(request?.stockSales).toBe('low');
    expect(classifyRead('products below 5 that sold today', 'en', now)?.stockBelow).toBe(4);
    const { seen, api } = source({
      products: async () => ({ items: held, hasMore: false }),
      stockCounts: async () => ({ low: 2, out: 0 }),
      saleLines: async () => posted,
      productsByIds: async () => [
        { id: 'old', status: 'archived' as const },
        { id: 'healthy', status: 'active' as const },
      ],
    });
    const snapshot = await loadReadSnapshot(owner, request!, api, now);
    expect(seen).toContain('lines:demoStore:2026-10-26:2026-10-26');
    expect(seen.some((call) => call.startsWith('lines:Second'))).toBe(false);
    expect(snapshot.text).toContain('«Demo phone» phone: 2 on hand, 3 net units');
    expect(snapshot.text).toContain('Invoice line: «Old phone»');
    expect(snapshot.text).toContain('store setting');
    expect(snapshot.text).toContain('default 10');
    expect(snapshot.text).toContain('no net units in this range: 1');
    expect(snapshot.text).not.toContain('Last charger');
    expect(snapshot.text).not.toContain('Phone case');
    expect(snapshot.text).toContain('«Archived case» old is archived. Current stock is not shown.');
    expect(snapshot.text).toContain('«Retired cable» gone is not in the current catalog. Current stock is not shown.');
    expect(snapshot.text).not.toContain('Second Store');
    expect(snapshot.text).not.toMatch(/\d[\d,]* LBP/);
    expect(snapshot.text).not.toContain('$');
    expect(snapshot.text).toContain('No purchase quantity or days of stock is calculated.');
    expect(composeLiveAnswer(snapshot.text, 'Mystery cable: 9 on hand, 4 net units.').wording).toBeNull();
    expect(composeLiveAnswer(snapshot.text, 'Reorder 6. Days of stock remaining: 2.').wording).toBeNull();
    expect(composeLiveAnswer(snapshot.text, null).text).toContain('2 on hand, 3 net units');

    const out = classifyRead('Which products are out of stock but had recorded sales this week?', 'en', now);
    expect(out?.stockSales).toBe('out');
    expect(out?.rankRange).toMatchObject({ from: '2026-10-20', to: '2026-10-26' });
    const zero = await loadReadSnapshot(owner, out!, source({
      products: async () => ({ items: [{ id: 'case', name: 'Phone case', stock: 0 }], hasMore: false }),
      stockCounts: async () => ({ low: 0, out: 1 }),
      saleLines: async () => ({
        sales: [{
          id: 's9',
          soldOn: '2026-10-22',
          currency: 'LBP' as const,
          lines: [{ productId: 'case', name: 'Phone case', quantity: 3, returnedQty: 1, unitUsdCents: 100, unitLbp: 5000 }],
        }],
        complete: true,
      }),
    }).api, now);
    expect(zero.text).toContain('«Phone case» case: 0 on hand, 2 net units');
    expect(composeLiveAnswer(zero.text, 'No products are out of stock but had recorded sales today.').wording).toBeNull();
    expect(zero.text).toContain('Current stock is zero');
    expect(zero.text).not.toContain('5000');

    const copies = await loadReadSnapshot(owner, classifyRead('low-stock products that sold today', 'en', now)!, source({
      products: async () => ({
        items: [
          { id: 'a', name: 'USB cable', stock: 4 },
          { id: 'b', name: 'USB cable', stock: 1 },
        ],
        hasMore: false,
      }),
      stockCounts: async () => ({ low: 2, out: 0 }),
      saleLines: async () => ({
        sales: [{
          id: 's3',
          soldOn: '2026-10-26',
          currency: 'USD' as const,
          lines: [
            { productId: 'a', name: 'USB cable', quantity: 2, returnedQty: 0, unitUsdCents: 1, unitLbp: 0 },
            { productId: 'b', name: 'USB cable', quantity: 2, returnedQty: 0, unitUsdCents: 1, unitLbp: 0 },
          ],
        }],
        complete: true,
      }),
    }).api, now);
    expect(copies.text).toContain('«USB cable» a: 4 on hand, 2 net units');
    expect(copies.text).toContain('«USB cable» b: 1 on hand, 2 net units');
    expect(copies.text).toContain('Equal net units are a tie');

    const arabic = classifyRead('شو المنتجات اللي مخزونها قليل وانباعت اليوم؟', 'en', now);
    expect(arabic?.lang).toBe('ar');
    expect(arabic?.topics).toEqual(['stockSales']);
    const ar = await loadReadSnapshot(owner, arabic!, source({
      products: async () => ({ items: [], hasMore: false }),
      stockCounts: async () => ({ low: 0, out: 0 }),
      saleLines: async () => ({ sales: [], complete: true }),
    }).api, now);
    expect(ar.text).toContain('لا توجد وحدات صافية');
    expect(ar.text).not.toContain('«');
  });

  it('withholds a partial join, a missing permission, and another store', async () => {
    const request = classifyRead('Which low-stock products also sold today?', 'en', now);
    const partial = await loadReadSnapshot(owner, request!, source({
      products: async () => ({ items: [{ id: 'phone', name: 'Demo phone', stock: 2 }], hasMore: true }),
      stockCounts: async () => ({ low: 9, out: 0 }),
      saleLines: async () => posted,
    }).api, now);
    expect(partial.text).toContain('incomplete');
    expect(partial.text).toContain('No ranking is shown');
    expect(partial.text).not.toContain('«');
    expect(partial.text).not.toContain('3 net units');

    const unread = await loadReadSnapshot(owner, request!, source({
      products: async () => ({ items: held, hasMore: false }),
      stockCounts: async () => ({ low: 2, out: 0 }),
      saleLines: async () => ({ sales: posted.sales, complete: false }),
    }).api, now);
    expect(unread.text).toContain('No ranking is shown');
    expect(unread.text).not.toContain('Demo phone');

    const productsOnly = session((permission) => permission === 'canViewProducts');
    const hiddenSales = await loadReadSnapshot(productsOnly, classifyRead('Which low-stock products also sold today at Second Store?', 'en', now)!, source({
      products: async () => { throw new Error('should-not-read'); },
      saleLines: async () => { throw new Error('should-not-read'); },
    }).api, now);
    expect(hiddenSales.status).toBe('denied');
    expect(hiddenSales.consultModel).toBe(false);
    expect(hiddenSales.text).toContain('View sales & returns');
    expect(hiddenSales.text).toContain('The combined list is not shown');
    expect(hiddenSales.text).not.toContain('Demo phone');
    expect(hiddenSales.text).not.toContain('Second Store');

    const salesOnly = session((permission) => permission === 'canViewSales');
    const hiddenStock = await loadReadSnapshot(salesOnly, request!, source().api, now);
    expect(hiddenStock.text).toContain('View products');
    expect(hiddenStock.text).toContain('The combined list is not shown');
    expect(hiddenStock.text).not.toContain('on hand');

    const cashierJoin = await loadReadSnapshot(cashier, request!, source().api, now);
    expect(cashierJoin.status).toBe('denied');
    expect(cashierJoin.consultModel).toBe(false);
    expect(cashierJoin.text).not.toContain('net units');
  });
});

describe('answer validation', () => {
  const joined = [
    'From 2026-10-26 to 2026-10-26. Top 3 of 3.',
    '1. «Phase6 Twin» ai6-twin-a: 3 on hand, 5 net units.',
    '2. «Phase6 Low Sold» ai6-low: 2 on hand, 3 net units. Invoice line: «Phase6 Old Label».',
    '3. «Phase6 Twin» ai6-twin-b: 2 on hand, 1 net units.',
  ].join('\n');

  it('rejects a swapped or reassigned figure and keeps the trusted note', () => {
    const swapped = composeLiveAnswer(joined, '«Phase6 Twin» ai6-twin-a: 5 on hand, 3 net units.');
    expect(swapped.wording).toBeNull();
    expect(swapped.text).toBe(joined);
    expect(composeLiveAnswer(joined, '«Phase6 Low Sold» ai6-low: 5 net units.').wording).toBeNull();
    expect(composeLiveAnswer(joined, 'Mystery phone: 5 net units.').wording).toBeNull();
    expect(composeLiveAnswer(joined, 'From 2026-10-20 to 2026-10-26.').wording).toBeNull();
    expect(composeLiveAnswer(joined, 'The total is 5 EUR.').wording).toBeNull();
    expect(composeLiveAnswer(joined, 'No products had recorded sales today.').wording).toBeNull();
    expect(composeLiveAnswer(joined, null).text).toBe(joined);
    expect(composeLiveAnswer(joined, null).wording).toBeNull();

    const faithful = composeLiveAnswer(joined, 'Phase6 Low Sold still has 2 on hand and 3 net units.');
    expect(faithful.text).toBe(joined);
    expect(faithful.wording).toContain('2 on hand and 3 net units');
  });

  it('allows an empty result to be described as empty and rejects a denial of a real list', async () => {
    const emptyRank = [
      'From 2026-10-26 to 2026-10-26.',
      'No net units were sold in this range. This is not a ranking of zero.',
    ].join('\n');
    expect(composeLiveAnswer(emptyRank, 'No net units were sold in this range.').wording).toContain('No net units were sold');
    expect(composeLiveAnswer(emptyRank, 'Demo phone: 4 net units.').wording).toBeNull();

    const listed = await loadReadSnapshot(owner, classifyRead('how many products are low in stock?', 'en', now)!, source({
      stockCounts: async () => ({ low: 1, out: 0 }),
      products: async () => ({ items: [{ id: 'phone', name: 'Demo phone', stock: 2 }], hasMore: false }),
    }).api, now);
    expect(listed.text).toContain('Full count: 1');
    expect(composeLiveAnswer(listed.text, 'No products are low in stock.').wording).toBeNull();
    expect(composeLiveAnswer(listed.text, null).text).toBe(listed.text);

    const emptyList = await loadReadSnapshot(owner, classifyRead('how many products are low in stock?', 'en', now)!, source({
      stockCounts: async () => ({ low: 0, out: 0 }),
      products: async () => ({ items: [], hasMore: false }),
    }).api, now);
    expect(emptyList.text).toContain('Full count: 0');
    expect(composeLiveAnswer(emptyList.text, 'No products are low in stock. Full count: 0.').wording).toContain('Full count: 0');
  });

  it('covers expiry beside the other reads when data, emptiness, failure, or permission changes', async () => {
    const expiry = await loadReadSnapshot(owner, classifyRead('Which products expire soon?', 'en', now)!, source({
      expiry: async () => ({ expired: 1, soon: 0, soonDays: 30, listed: [{ name: 'Demo phone', expiryDate: '2026-10-01', stock: 2 }], listIncomplete: false }),
    }).api, now);
    expect(expiry.consultModel).toBe(true);
    expect(expiry.text).toContain('Expired: 1');
    expect(expiry.text).toContain('Demo phone: 2026-10-01 (2)');
    expect(composeLiveAnswer(expiry.text, 'Nothing expires. The date is 2026-11-01.').wording).toBeNull();
    expect(composeLiveAnswer(expiry.text, null).text).toContain('Expired: 1');

    const none = await loadReadSnapshot(owner, classifyRead('Which products expire soon?', 'en', now)!, source({
      expiry: async () => ({ expired: 0, soon: 0, soonDays: 30, listed: [], listIncomplete: false }),
    }).api, now);
    expect(none.text).toContain('Expired: 0');
    expect(none.text).toContain('none');

    const failed = await loadReadSnapshot(owner, classifyRead('Which products expire soon?', 'en', now)!, source({
      expiry: async () => { throw new Error('down'); },
    }).api, now);
    expect(failed.status).toBe('unavailable');
    expect(failed.consultModel).toBe(false);
    expect(failed.text).toContain('expiry could not be read');
    expect(composeLiveAnswer(failed.text, 'Demo phone expires on 2026-10-01.').wording).toBeNull();

    const denied = await loadReadSnapshot(cashier, classifyRead('شو المنتجات اللي صلاحيتها قربت؟', 'en', now)!, source().api, now);
    expect(denied.consultModel).toBe(false);
    expect(denied.text).toMatch(/View products|عرض المنتجات/);
    expect(denied.text).not.toContain('Demo phone');
  });
});

describe('arabic wording and debt words', () => {
  it('names an Arabic range in Arabic and keeps the same dates', async () => {
    const sales = await loadReadSnapshot(owner, classifyRead('قديش بعنا اليوم؟', 'ar', now)!, source().api, now);
    expect(sales.text).toContain('مبيعات من 2026-10-26 إلى 2026-10-26');
    expect(sales.text).toContain('النطاق اليوم');
    expect(sales.text).not.toContain('today');
    expect(sales.text).not.toContain('lastMonth');

    const english = await loadReadSnapshot(owner, classifyRead('How much did we sell today?', 'en', now)!, source().api, now);
    expect(english.text).toContain('Sales from 2026-10-26 to 2026-10-26');
    expect(english.text).toContain('range today');

    const compared = classifyRead('قارن أكتر منتج انباع هالشهر مع الشهر الماضي', 'ar', now);
    expect(compared?.rankRange).toMatchObject({ from: '2026-10-01', to: '2026-10-26', label: 'month' });
    expect(compared?.compareRange).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'lastMonth' });
    const note = await loadReadSnapshot(owner, compared!, source().api, now);
    expect(note.text).toContain('2026-10-01');
    expect(note.text).toContain('2026-09-30');
    expect(note.text).toContain('هذا الشهر');
    expect(note.text).toContain('الشهر الماضي');
    expect(note.text).not.toContain('lastMonth');
    expect(note.text).not.toMatch(/\bmonth\b/);
  });

  it('treats debt words as debts and ignores دين inside a longer word', () => {
    const topics = (question: string) => classifyRead(question, 'en', now)?.topics ?? [];
    expect(topics('مين عليه مصاري؟')).toContain('debts');
    expect(topics('شو الديون اليوم؟')).toContain('debts');
    expect(topics('مين مديون عنا؟')).toContain('debts');
    expect(topics('who owes us?')).toContain('debts');
    expect(topics('show the debtor list')).toContain('debts');
    // "how much" alone is not a sales totals ask — debt wording stays on debts only.
    expect(topics('how much debt عند Ali')).toEqual(['debts']);
    expect(topics('how much debt عند Ali')).not.toContain('sales');
    expect(topics('وين المدينة؟')).not.toContain('debts');
    expect(topics('أنا من المدينة')).not.toContain('debts');
    expect(topics('ديناصور')).not.toContain('debts');
    expect(topics('how many USB cable do we have?')).not.toContain('debts');
  });
});

describe('cash intent words', () => {
  const topics = (question: string) => classifyRead(question, 'en', now)?.topics ?? [];

  it('keeps real cash questions and ignores كاش inside كاشير', () => {
    for (const question of [
      'قديش في كاش بالصندوق؟',
      'قديش رصيد الصندوق؟',
      'شو وضع الكاش؟',
      'cash drawer balance',
      'how much cash do we have?',
      'قديش cash، بالصندوق؟',
      'شو وضع الكاش.',
      'how much cash بالكاش?',
    ]) {
      expect(topics(question), question).toContain('cashbox');
    }
    for (const question of ['كاشير', 'الكاشير', 'شو اسم الكاشير؟', 'كاشيرة', 'how many USB cables are low in stock?']) {
      expect(topics(question), question).not.toContain('cashbox');
    }
    expect(topics('قديش بعنا اليوم؟')).toEqual(['sales']);
    expect(topics('مين عليه مصاري؟')).toContain('debts');
    expect(topics('شو المنتجات اللي صلاحيتها قربت؟')).toContain('expiry');
    expect(topics('شو أكتر منتج انباع اليوم؟')).toContain('productRank');
  });

  it('withholds drawer amounts without canManageCashDrawer', async () => {
    for (const question of ['شو وضع الكاش؟', 'cash drawer balance?', 'قديش كاش مع الكاشير؟']) {
      const { seen, api } = source();
      const request = classifyRead(question, 'en', now);
      expect(request?.topics, question).toContain('cashbox');
      const snapshot = await loadReadSnapshot(cashier, request!, api, now);
      expect(snapshot.consultModel, question).toBe(false);
      expect(snapshot.text, question).toMatch(/Cash drawer|الصندوق/);
      expect(snapshot.text, question).not.toContain('$');
      expect(snapshot.text, question).not.toContain('250000');
      expect(snapshot.text, question).not.toContain('10000');
      expect(seen.some((call) => call.startsWith('cash:')), question).toBe(false);
    }
  });
});
