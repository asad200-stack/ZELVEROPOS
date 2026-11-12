import { describe, expect, it } from 'vitest';
import { publishedKnowledge } from './catalog';
import { AI_TOOLS, answerQuestion, searchKnowledge } from './engine';
import { classifyRead } from './readIntent';

const now = new Date(2026, 9, 30, 12, 0, 0);

describe('Zelvero AI accuracy audit — routing', () => {
  it('sends procedural sale/return/credit questions to knowledge, not live', () => {
    expect(classifyRead('How do I process a sale from cart to payment?', 'en', now)).toBeNull();
    expect(
      classifyRead(
        'Explain how a customer return works. What happens to stock, the cash drawer, and customer debt for cash versus credit?',
        'en',
        now,
      ),
    ).toBeNull();
    expect(classifyRead('How do I receive a customer debt payment?', 'en', now)).toBeNull();
    expect(classifyRead('What settings control low stock?', 'en', now)).toBeNull();
  });

  it('keeps explicit figure asks on live topics', () => {
    expect(classifyRead('How much did we sell today?', 'en', now)?.topics).toEqual(['sales']);
    expect(classifyRead('How much cash do we have?', 'en', now)?.topics).toContain('cashbox');
    expect(classifyRead('Who owes us money?', 'en', now)?.topics).toContain('debts');
    expect(classifyRead('how many products are low in stock?', 'en', now)?.topics).toContain('lowStock');
    expect(classifyRead('What were our returns yesterday?', 'en', now)?.topics).toContain('sales');
  });

  it('clarifies only when how-to wording mixes with an explicit live-figures ask', () => {
    expect(classifyRead('Explain how to read today sales totals in the POS', 'en', now)?.clarify).toBe(true);
  });

  it('does not pretend purchases or expenses have live reads', () => {
    expect(classifyRead('How much did we purchase this month?', 'en', now)).toBeNull();
    expect(classifyRead('Show me the expenses', 'en', now)).toBeNull();
    expect(classifyRead('Show me profit report for this month', 'en', now)).toBeNull();
  });
});

describe('Zelvero AI accuracy audit — knowledge grounding', () => {
  it('keeps financial tools off the allowlist', () => {
    expect(AI_TOOLS).toContain('navigate');
    expect(AI_TOOLS).not.toContain('checkout' as (typeof AI_TOOLS)[number]);
  });

  it('answers sale and return workflows from dedicated documents', () => {
    const saleQ = 'Explain the complete steps for processing a sale until confirming payment.';
    const saleHits = searchKnowledge(publishedKnowledge, saleQ, '/pos');
    expect(saleHits.some((s) => s.id === 'document:pos-sale-workflow')).toBe(true);
    const sale = answerQuestion(publishedKnowledge, {
      question: saleQ,
      lang: 'en',
      route: '/pos',
      isOwner: true,
      isSuperAdmin: false,
      can: () => true,
    });
    expect(sale.text).toMatch(/canSell|cart|checkout|cash|credit/i);
    expect(sale.executes).toBe(false);
    expect(sale.sources).toEqual([]);

    const retQ = 'Explain how a customer return works for cash versus credit sales.';
    const retHits = searchKnowledge(publishedKnowledge, retQ, '/pos');
    expect(retHits.some((s) => s.id === 'document:pos-return-workflow')).toBe(true);
    const ret = answerQuestion(publishedKnowledge, {
      question: retQ,
      lang: 'en',
      route: '/pos',
      isOwner: true,
      isSuperAdmin: false,
      can: () => true,
    });
    expect(ret.text).toMatch(/stock|drawer|debt/i);
  });

  it('does not rank the customer-return document first for debt payment how-tos', () => {
    const hits = searchKnowledge(publishedKnowledge, 'How do I receive a customer debt payment?', '/customers');
    expect(hits[0]?.id).not.toBe('document:pos-return-workflow');
  });

  it('does not rank the customer-return document first for supplier-return how-tos', () => {
    const hits = searchKnowledge(publishedKnowledge, 'Explain purchase return to supplier workflow', '/purchases');
    expect(hits[0]?.id).not.toBe('document:pos-return-workflow');
  });

  it('describes expenses as a cashbox move label, not a separate module', () => {
    const answered = answerQuestion(publishedKnowledge, {
      question: 'How do I record an expense?',
      lang: 'en',
      route: '/cashbox',
      isOwner: true,
      isSuperAdmin: false,
      can: () => true,
    });
    expect(answered.status).toBe('answered');
    expect(answered.text).toMatch(/Expense|cashbox|\/cashbox/i);
    expect(answered.text).not.toMatch(/separate expenses module|expense page at \/expenses/i);
  });
});
