import { describe, expect, it } from 'vitest';
import { composeLiveAnswer } from './liveWording';
import { modelRequest, phraseWithLocalModel, probeLocalModel } from './localModel';
import type { RankSale } from './productRank';
import { classifyRead } from './readIntent';
import { loadReadSnapshot, type AiReadSource } from './readSnapshot';
import type { DailyStats } from '@/services/reportService';

/**
 * Hits the local llama.cpp server. Skipped unless ZELVERO_AI_LIVE=1,
 * because the weights are not part of the normal test run.
 */
const live = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ZELVERO_AI_LIVE === '1';
const origin = 'http://127.0.0.1:8081';
const now = new Date(2026, 9, 26, 12, 0, 0);
const owner = { tenantId: 'demoStore', route: '/pos', isOwner: true, can: () => true };

function quietSource(stats: DailyStats[]): AiReadSource {
  const unused = async () => {
    throw new Error('not-this-topic');
  };
  return {
    dailyStats: async (tenantId) => {
      if (tenantId !== 'demoStore') throw new Error('wrong-store');
      return stats;
    },
    cashbox: unused,
    products: unused,
    threshold: unused,
    expiry: unused,
    debts: unused,
    saleLines: unused,
    stockCounts: unused,
    findStock: unused,
    productsByIds: unused,
  };
}

function line(productId: string, name: string, quantity: number, returnedQty: number, unitUsdCents = 100, unitLbp = 0) {
  return { productId, name, quantity, returnedQty, unitUsdCents, unitLbp };
}

function fixtureSource(sales: RankSale[], complete = true): AiReadSource {
  const unused = async () => {
    throw new Error('not-this-topic');
  };
  return {
    dailyStats: unused,
    cashbox: unused,
    products: unused,
    threshold: unused,
    expiry: unused,
    debts: unused,
    stockCounts: unused,
    findStock: unused,
    productsByIds: unused,
    async saleLines(tenantId) {
      if (tenantId !== 'demoStore') throw new Error('wrong-store');
      return { sales, complete };
    },
  };
}

async function askModel(label: string, question: string, source: AiReadSource) {
  const request = classifyRead(question, 'en', now);
  if (!request) throw new Error('not-a-read');
  const snapshot = await loadReadSnapshot(owner, request, source, now);
  const prompt = modelRequest(question, snapshot.text, snapshot.lang, 'live');
  const raw = await phraseWithLocalModel(origin, question, snapshot.text, snapshot.lang, 120_000, 'live');
  const shown = composeLiveAnswer(snapshot.text, raw);
  console.info(`CASE=${label}`);
  console.info(`PROMPT=${JSON.stringify(prompt)}`);
  console.info(`MODEL=${JSON.stringify(raw)}`);
  console.info(`VALIDATOR=${shown.wording ? 'accepted' : 'rejected'}`);
  console.info(`DISPLAYED=${JSON.stringify(shown.text)}`);
  console.info(`ASIDE=${JSON.stringify(shown.wording)}`);
  return { snapshot, raw, shown };
}

describe.skipIf(!live)('local Qwen completion against the store note', () => {
  it('does not turn an empty sales day into a zero total', async () => {
    const snapshot = await loadReadSnapshot(owner, classifyRead('How much did we sell today?', 'en', now)!, quietSource([]), now);
    const raw = await phraseWithLocalModel(origin, 'How much did we sell today?', snapshot.text, 'en', 120_000, 'live');
    const shown = composeLiveAnswer(snapshot.text, raw);
    console.info(`EMPTY_SALES_MODEL=${JSON.stringify(raw)}`);
    console.info(`EMPTY_SALES_WORDING=${JSON.stringify(shown.wording)}`);
    expect(shown.text).toContain('No sales are recorded');
    expect(shown.text).not.toContain('$0.00');
    expect(shown.wording === null || /no sales are recorded|nothing (?:is|was) recorded/i.test(shown.wording)).toBe(true);
    const visible = [shown.text, shown.wording].filter(Boolean).join('\n');
    expect(visible).toContain('No sales are recorded');
    expect(visible.trim()).not.toBe('0');
  }, 130_000);

  it('keeps invoice count, net sales, returns, and USD when the model rephrases a real day', async () => {
    const stats: DailyStats = {
      date: '2026-10-26',
      salesCount: 4,
      revenueUsdCents: 10_000,
      costUsdCents: 4_000,
      discountUsdCents: 0,
      checkoutDiscountUsdCents: 0,
      cashSalesUsdCents: 0,
      creditSalesUsdCents: 0,
      debtCollectedUsdCents: 0,
      creditIssuedUsdCents: 0,
      returnsCount: 1,
      returnsUsdCents: 500,
      returnsCostUsdCents: 0,
      expensesUsdCents: 0,
    };
    const snapshot = await loadReadSnapshot(owner, classifyRead('Summarize today sales', 'en', now)!, quietSource([stats]), now);
    const raw = await phraseWithLocalModel(origin, 'Summarize today sales', snapshot.text, 'en', 120_000, 'live');
    const shown = composeLiveAnswer(snapshot.text, raw);
    console.info(`REAL_SALES_MODEL=${JSON.stringify(raw)}`);
    console.info(`REAL_SALES_WORDING=${JSON.stringify(shown.wording)}`);
    expect(shown.text).toContain('Invoices: 4');
    expect(shown.text).toContain('Net sales: $95.00 USD');
    expect(shown.text).toContain('Returns: 1, $5.00 USD');
    expect(shown.text).toContain('USD only');
    expect(shown.text).toContain('no LBP total');
    if (shown.wording) {
      expect(shown.wording).not.toMatch(/\$40\.00|\$0\.00/);
      for (const amount of shown.wording.match(/\$\d[\d,]*\.\d{2}\s*USD/gi) ?? []) {
        expect(shown.text.replace(/,/g, '')).toContain(amount.replace(/,/g, ''));
      }
    }
  }, 130_000);

  it('keeps a three-product unit ranking and drops a fully returned product', async () => {
    const { snapshot, shown } = await askModel(
      'distinct-units',
      'What were my best-selling products today?',
      fixtureSource([
        {
          id: 's1',
          soldOn: '2026-10-26',
          currency: 'USD',
          lines: [
            line('p1', 'Demo phone', 5, 0),
            line('p2', 'USB cable', 3, 0),
            line('p3', 'Last charger', 1, 0),
            line('p4', 'Returned case', 4, 4),
          ],
        },
      ]),
    );
    expect(shown.text).toBe(snapshot.text);
    expect(shown.text).toContain('1. «Demo phone»: 5 net units');
    expect(shown.text).toContain('2. «USB cable»: 3 net units');
    expect(shown.text).toContain('3. «Last charger»: 1 net units');
    expect(shown.text).not.toContain('Returned case');
    expect(shown.text.indexOf('Demo phone')).toBeLessThan(shown.text.indexOf('USB cable'));
    expect(shown.text.indexOf('USB cable')).toBeLessThan(shown.text.indexOf('Last charger'));
    expect(shown.wording === null || !/Returned case|Mystery|Ghost/i.test(shown.wording)).toBe(true);
    expect(shown.wording === null || !/\$\d/.test(shown.wording)).toBe(true);
  }, 150_000);

  it('does not let the model name a sole winner when two products tie', async () => {
    const { snapshot, raw, shown } = await askModel(
      'tie',
      'What were my best-selling products today?',
      fixtureSource([
        {
          id: 's1',
          soldOn: '2026-10-26',
          currency: 'USD',
          lines: [line('p1', 'Demo phone', 4, 0), line('p2', 'USB cable', 4, 0), line('p3', 'Last charger', 1, 0)],
        },
      ]),
    );
    expect(shown.text).toBe(snapshot.text);
    expect(shown.text).toContain('Equal net units are a tie');
    expect(shown.text).toContain('«Demo phone»: 4 net units');
    expect(shown.text).toContain('«USB cable»: 4 net units');
    expect(shown.text).toContain('«Last charger»: 1 net units');
    expect(shown.wording === null || !/sold the most/i.test(shown.wording)).toBe(true);
    if (/sold the most/i.test(raw)) expect(shown.wording).toBeNull();
  }, 150_000);

  it('withholds a mixed USD and LBP revenue ranking', async () => {
    const { snapshot, shown } = await askModel(
      'mixed-revenue',
      'Rank the best-selling products today by revenue',
      fixtureSource([
        { id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [line('p1', 'Demo phone', 2, 0, 1500, 0)] },
        { id: 's2', soldOn: '2026-10-26', currency: 'LBP', lines: [line('p2', 'USB cable', 9, 0, 0, 80000)] },
      ]),
    );
    expect(shown.text).toBe(snapshot.text);
    expect(shown.text).toContain('No ranking is shown');
    expect(shown.text).toContain('not combined');
    expect(shown.text).not.toContain('«');
    expect(shown.text).not.toMatch(/\$\d|\d[\d,]* LBP/);
    expect(shown.wording === null || /no ranking is shown/i.test(shown.wording)).toBe(true);
    expect(shown.wording === null || !/combined total|Demo phone|USB cable/i.test(shown.wording)).toBe(true);
  }, 150_000);

  it('does not rank an incomplete invoice page', async () => {
    const { snapshot, shown } = await askModel(
      'incomplete-page',
      'What were my best-selling products today?',
      fixtureSource(
        [{ id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [line('p1', 'Demo phone', 5, 0)] }],
        false,
      ),
    );
    expect(shown.text).toBe(snapshot.text);
    expect(shown.text).toContain('incomplete');
    expect(shown.text).toContain('No ranking is shown');
    expect(shown.text).not.toContain('«');
    expect(shown.text).not.toContain('5 net units');
    expect(shown.wording === null || (/no ranking is shown/i.test(shown.wording) && /incomplete/i.test(shown.wording))).toBe(true);
    expect(shown.wording === null || !/Demo phone/i.test(shown.wording)).toBe(true);
  }, 150_000);

  it('keeps the meaning that no net units were sold', async () => {
    const { snapshot, shown } = await askModel('no-units', 'What were my best-selling products today?', fixtureSource([]));
    expect(shown.text).toBe(snapshot.text);
    expect(shown.text).toContain('No net units were sold');
    expect(shown.text).toContain('not a ranking of zero');
    expect(shown.text).not.toContain('$0.00');
    expect(shown.text).not.toContain('«');
    expect(shown.wording === null || /no net units were sold/i.test(shown.wording)).toBe(true);
    expect(shown.text.trim()).not.toBe('0');
  }, 150_000);

  it('keeps the trusted note when the model times out or is unavailable', async () => {
    const source = fixtureSource([
      { id: 's1', soldOn: '2026-10-26', currency: 'USD', lines: [line('p1', 'Demo phone', 2, 0)] },
    ]);
    const request = classifyRead('What were my best-selling products today?', 'en', now);
    const snapshot = await loadReadSnapshot(owner, request!, source, now);
    await expect(phraseWithLocalModel(origin, 'What were my best-selling products today?', snapshot.text, 'en', 1, 'live')).rejects.toThrow();
    const timedOut = composeLiveAnswer(snapshot.text, null);
    expect(timedOut.text).toBe(snapshot.text);
    expect(timedOut.text).toContain('«Demo phone»: 2 net units');
    expect(timedOut.wording).toBeNull();
    console.info('CASE=timeout');
    console.info('MODEL=unavailable-timeout');
    console.info('VALIDATOR=not-called');
    console.info(`DISPLAYED=${JSON.stringify(timedOut.text)}`);

    expect(await probeLocalModel('http://127.0.0.1:8099')).toBe(false);
    await expect(phraseWithLocalModel('http://127.0.0.1:8099', 'What were my best-selling products today?', snapshot.text, 'en', 2_000, 'live')).rejects.toThrow();
    const down = composeLiveAnswer(snapshot.text, null);
    expect(down.text).toBe(snapshot.text);
    expect(down.wording).toBeNull();
    console.info('CASE=model-down');
    console.info('VALIDATOR=not-called');
    console.info(`DISPLAYED=${JSON.stringify(down.text)}`);
  }, 30_000);
});
