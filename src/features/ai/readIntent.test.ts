import { describe, expect, it } from 'vitest';
import { publishedKnowledge } from './catalog';
import { AI_TOOLS, answerQuestion } from './engine';
import { asksExplicitLiveFigures, asksProfitFigure, asksSalesTotals, classifyRead, continueRead, isProcedureQuestion } from './readIntent';

const now = new Date(2026, 9, 30, 12, 0, 0);
const WORKFLOW =
  'Explain the complete steps for processing a sale in Zelvero POS, from adding products to the cart until confirming payment. Do not tell me where buttons are located. Explain the actual workflow.';
const RETURN_WORKFLOW =
  'Explain how a customer return works in Zelvero POS. What happens to stock, the cash drawer, and customer debt when returning a cash sale versus a credit sale?';

describe('AI question routing: knowledge vs live vs clarify', () => {
  it('routes the sale-workflow question to knowledge, not live sales', () => {
    expect(isProcedureQuestion(WORKFLOW)).toBe(true);
    expect(asksSalesTotals(WORKFLOW)).toBe(false);
    expect(classifyRead(WORKFLOW, 'en', now)).toBeNull();

    const answered = answerQuestion(publishedKnowledge, {
      question: WORKFLOW,
      lang: 'en',
      route: '/pos',
      isOwner: true,
      isSuperAdmin: true,
      can: () => true,
    });
    expect(answered.status).toBe('answered');
    expect(answered.executes).toBe(false);
    expect(AI_TOOLS).toContain('navigate');
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    expect(answered.text).toMatch(/cart/i);
    expect(answered.text).toMatch(/cash|credit|checkout|payment/i);
    expect(answered.text).toMatch(/quantity|quantities/i);
    expect(answered.text).toMatch(/discount|canEditPrice|price/i);
    expect(answered.text).toMatch(/cannot run|does not run|read-only|will not|Zelvero AI/i);
    expect(answered.sources).toEqual([]);
  });

  it('routes the return-workflow question to knowledge despite stock/cash/debt nouns', () => {
    expect(isProcedureQuestion(RETURN_WORKFLOW)).toBe(true);
    expect(asksExplicitLiveFigures(RETURN_WORKFLOW)).toBe(false);
    expect(classifyRead(RETURN_WORKFLOW, 'en', now)).toBeNull();

    const answered = answerQuestion(publishedKnowledge, {
      question: RETURN_WORKFLOW,
      lang: 'en',
      route: '/pos',
      isOwner: true,
      isSuperAdmin: true,
      can: () => true,
    });
    expect(answered.status).toBe('answered');
    expect(answered.executes).toBe(false);
    expect(AI_TOOLS).toContain('navigate');
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    expect(answered.text).toMatch(/stock|restor/i);
    expect(answered.text).toMatch(/drawer|cash/i);
    expect(answered.text).toMatch(/debt|credit/i);
    expect(answered.text).toMatch(/cannot call|cannot run|does not run|read-only|Zelvero AI/i);
    expect(answered.sources).toEqual([]);
  });

  it('keeps representative live-data questions on store reads', () => {
    expect(classifyRead('How much did we sell today?', 'en', now)?.topics).toEqual(['sales']);
    expect(classifyRead('Summarize today sales', 'en', now)?.topics).toContain('sales');
    expect(classifyRead('How much cash do we have in USD and LBP?', 'en', now)?.topics).toContain('cashbox');
    expect(classifyRead('how many products are low in stock?', 'en', now)?.topics).toContain('lowStock');
    expect(classifyRead('Who owes us money?', 'en', now)?.topics).toContain('debts');
    expect(classifyRead('قديش بعنا اليوم؟', 'ar', now)?.topics).toContain('sales');
  });

  it('clarifies only when how-to wording is mixed with an explicit live-figures ask', () => {
    const mixed = classifyRead('Explain how to read today sales totals in the POS', 'en', now);
    expect(mixed?.clarify).toBe(true);
    expect(mixed?.topics).toEqual([]);
  });

  it('still treats Arabic how-to checkout as knowledge', () => {
    expect(classifyRead('كيف بعمل checkout؟', 'ar', now)).toBeNull();
  });

  it('reads today’s profit when the user asks if they made money', () => {
    for (const question of ['أنا ربحت اليوم', 'شوف لي الدانة اليوم ربحان', 'قديش ربحت اليوم', 'بدي اعرف ربحي اليوم']) {
      const read = classifyRead(question, 'en', now);
      expect(read?.topics).toEqual(['sales']);
      expect(read?.includeProfit).toBe(true);
      expect(read?.profitAnswer).toBe('net');
      expect(read?.range.label).toBe('today');
      expect(asksProfitFigure(question)).toBe(true);
    }
    expect(classifyRead('Show me profit report for this month', 'en', now)).toBeNull();
    expect(classifyRead('كيف بشوف تقرير الأرباح', 'ar', now)).toBeNull();
    for (const question of ['how is my profit today', 'كيف الربح اليوم', 'شو وضع الربح اليوم', 'how is my ربح today']) {
      expect(classifyRead(question, 'en', now)?.profitAnswer).toBe('net');
    }
    const first = classifyRead('how is my profit today', 'en', now);
    const next = continueRead(first, 'yesterday', now);
    expect(next?.profitAnswer).toBe('net');
    expect(next?.range.label).toBe('yesterday');
    expect(continueRead(first, 'open the products page', now)).toBeNull();
    expect(classifyRead('What is my gross and net revenue today?', 'en', now)?.salesFigure).toBe('both');
    expect(classifyRead('What is my gross revenue today?', 'en', now)?.salesFigure).toBe('gross');
  });
});
