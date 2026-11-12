import { describe, expect, it, vi } from 'vitest';
import { AI_FORBIDDEN_ACTIONS, AI_TOOLS } from './actions/allowlist';
import {
  financeCapabilityRefusalText,
  financeRefusalText,
  isFinancialCapabilityQuestion,
  isFinancialExecutionRequest,
} from './actions/financeGuard';
import { matchGuide, shortGuideAnswer } from './actions/guide';
import { handleOperatorTurn } from './actions/operator';
import { classifyOperatorIntent, isGuideIntent } from './actions/operatorIntent';
import {
  asksSalesTotals,
  classifyRead,
  isConceptualFinanceExplain,
  isProcedureQuestion,
} from './readIntent';

const now = new Date(2026, 9, 31, 12, 0, 0);

const opCtx = {
  lang: 'en' as const,
  tenantId: 't1',
  route: '/products',
  isOwner: true,
  can: () => true,
  navigate: vi.fn(),
  label: (key: string) => key.replace(/^nav\./, ''),
};

describe('P2 financial intent: discounts / cash vs credit / USD-LBP', () => {
  it('Q24 — discount how-to is conceptual, not live sales (count≠discounts bug)', () => {
    const q = 'How do discounts work in a sale?';
    expect(asksSalesTotals(q)).toBe(false);
    expect(isConceptualFinanceExplain(q)).toBe(true);
    expect(isProcedureQuestion(q)).toBe(true);
    expect(classifyRead(q, 'en', now)).toBeNull();
    expect(matchGuide(q)?.topic).toBe('discount');
    expect(shortGuideAnswer(q, 'en')).toMatch(/line discount|line prices|no whole-cart coupon/i);
    expect(shortGuideAnswer(q, 'en')).not.toMatch(/Live data|USD:/i);
  });

  it('Q26 — cash vs credit difference is explanation, not cashbox live read', () => {
    const q = 'What is the difference between cash and credit sales?';
    expect(isConceptualFinanceExplain(q)).toBe(true);
    expect(isGuideIntent(q)).toBe(true);
    expect(classifyRead(q, 'en', now)).toBeNull();
    expect(matchGuide(q)?.topic).toBe('cashVsCredit');
    expect(shortGuideAnswer(q, 'en')).toMatch(/Cash vs credit|customer debt|drawer/i);
    expect(shortGuideAnswer(q, 'en')).not.toMatch(/Live data|USD:/i);
  });

  it('Q118 — USD/LBP transfer how-to explains separate drawers, never executes', () => {
    const q = 'How do cash transfers between USD and LBP work?';
    expect(isConceptualFinanceExplain(q)).toBe(true);
    expect(classifyRead(q, 'en', now)).toBeNull();
    expect(matchGuide(q)?.topic).toBe('currencyTransfer');
    const text = shortGuideAnswer(q, 'en')!;
    expect(text).toMatch(/separate|exchange rate|will not/i);
    expect(text).not.toMatch(/Live data|transferred successfully/i);
  });

  it('Arabic / Lebanese phrasings stay on explanation', () => {
    const samples = [
      ['كيف بيشتغل الخصم بالبيع؟', 'discount'],
      ['شو الفرق بين البيع نقداً والدين؟', 'cashVsCredit'],
      ['كيف بيشتغل التحويل بين الدولار والليرة؟', 'currencyTransfer'],
      ['ما الفرق بين الكاش والدين؟', 'cashVsCredit'],
    ] as const;
    for (const [q, topic] of samples) {
      expect(classifyRead(q, 'ar', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe(topic);
      expect(shortGuideAnswer(q, 'ar'), q).toBeTruthy();
      expect(shortGuideAnswer(q, 'ar'), q).not.toMatch(/Live data|USD:/i);
    }
  });

  it('capability vs live vs execution stay separated', () => {
    expect(isFinancialCapabilityQuestion('Can AI move cash?')).toBe(true);
    expect(classifyRead('Can AI move cash?', 'en', now)).toBeNull();
    expect(financeCapabilityRefusalText('en')).toMatch(/cannot execute financial/i);

    expect(classifyRead('How much cash do we have?', 'en', now)?.topics).toContain('cashbox');
    expect(classifyRead('How much did we sell today?', 'en', now)?.topics).toEqual(['sales']);
    expect(isConceptualFinanceExplain('How much cash do we have?')).toBe(false);

    expect(isFinancialExecutionRequest('Checkout now')).toBe(true);
    expect(isFinancialExecutionRequest('Transfer 50 USD to LBP')).toBe(true);
    expect(isFinancialExecutionRequest('Apply a discount on this sale')).toBe(true);
    expect(isFinancialExecutionRequest('How do I complete checkout?')).toBe(false);
    expect(financeRefusalText('en')).toMatch(/cannot complete checkout/i);
  });

  it('how-to vs apply-discount execution', async () => {
    expect(classifyOperatorIntent('How do discounts work in a sale?')).toBe('guide');
    const guide = await handleOperatorTurn('How do discounts work in a sale?', opCtx, null);
    expect(guide.handled).toBe(true);
    expect(guide.text).toMatch(/line discount|line prices/i);
    expect(guide.text).not.toMatch(/applied|successfully/i);

    const apply = await handleOperatorTurn('Apply a discount on this sale', opCtx, null);
    expect(apply.handled).toBe(true);
    expect(apply.text).toMatch(/cannot complete checkout|cannot execute financial|cannot/i);
  });

  it('ambiguous mixed how-to + live figures still clarifies', () => {
    const mixed = classifyRead('Explain how to read today sales totals in the POS', 'en', now);
    expect(mixed?.clarify).toBe(true);
  });

  it('navigation / follow-up and allowlist safety unchanged', async () => {
    const navigate = vi.fn();
    const open = await handleOperatorTurn('Open products.', { ...opCtx, navigate }, null);
    expect(open.handled).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/products');

    const how = await handleOperatorTurn('How do I add a product?', opCtx, null);
    expect(how.pending?.kind).toBe('offerNavigate');
    const yes = await handleOperatorTurn('إيه', { ...opCtx, lang: 'ar', navigate: vi.fn() }, how.pending);
    expect(yes.handled).toBe(true);

    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    expect(AI_FORBIDDEN_ACTIONS.length).toBeGreaterThan(0);
    for (const id of ['checkout', 'refund', 'cashIn', 'cashOut', 'collectDebt', 'transfer'] as const) {
      expect(AI_TOOLS.includes(id as never)).toBe(false);
    }
  });
});
