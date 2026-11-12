import { describe, expect, it, vi } from 'vitest';
import { publishedKnowledge } from './catalog';
import { AI_TOOLS, answerQuestion } from './engine';
import { AI_FORBIDDEN_ACTIONS } from './actions/allowlist';
import {
  financeCapabilityRefusalText,
  isFinancialCapabilityQuestion,
  isFinancialExecutionRequest,
} from './actions/financeGuard';
import { matchGuide, shortGuideAnswer } from './actions/guide';
import { handleOperatorTurn } from './actions/operator';
import { classifyOperatorIntent, isExecuteCartAdd, isExecuteCreateProduct } from './actions/operatorIntent';
import { classifyRead } from './readIntent';
import { sanitizeUserFacingText } from './userFacingAnswer';

const owner = {
  question: '',
  lang: 'en' as const,
  route: '/products',
  isOwner: true,
  isSuperAdmin: false,
  can: () => true,
};

const opCtx = {
  lang: 'en' as const,
  tenantId: 't1',
  route: '/products',
  isOwner: true,
  can: () => true,
  navigate: vi.fn(),
  label: (key: string) => key.replace(/^nav\./, ''),
};

describe('audit repair P0/P1', () => {
  it('1. What is Zelvero POS? returns a system overview', () => {
    const a = answerQuestion(publishedKnowledge, { ...owner, question: 'What is Zelvero POS?' });
    expect(a.text).toMatch(/point-of-sale|point of sale|Zelvero POS is/i);
    expect(a.text).not.toMatch(/canUseZelveroAI|Access Zelvero AI|perm\./i);
    expect(a.text).not.toMatch(/src\/|\.test\.ts|Cloud Function/i);
  });

  it('2. Owner permission questions explain owner rights', () => {
    const a = answerQuestion(publishedKnowledge, { ...owner, question: 'Does the owner have all permissions?' });
    expect(a.text).toMatch(/owner|implicitly|every permission/i);
    expect(a.text).not.toMatch(/checkout\.test|test file|Cloud Function/i);
  });

  it('3. Product creation and cart-add intents stay separate', () => {
    expect(isExecuteCreateProduct('Add a new product')).toBe(true);
    expect(isExecuteCartAdd('Add PS5 to the cart')).toBe(true);
    expect(isExecuteCreateProduct('Add PS5 to the cart')).toBe(false);
    expect(classifyOperatorIntent('Add PS5 to the cart')).toBe('cartAdd');
    expect(classifyOperatorIntent('Add a product to the cart')).toBe('cartAdd');
    expect(classifyOperatorIntent('How do I add a product to the cart?')).toBe('guide');
    const guide = matchGuide('How do I add a product to the cart?');
    expect(guide?.topic).toBe('cartAdd');
    expect(shortGuideAnswer('How do I add a product to the cart?', 'en')).toMatch(/existing product|cart/i);
    expect(shortGuideAnswer('How do I add a product to the cart?', 'en')).not.toMatch(/Tap Add product/i);
  });

  it('4. Supplier return and customer return stay separate', () => {
    expect(matchGuide('How do I do a supplier return?')?.topic).toBe('supplierReturn');
    expect(matchGuide('How do I process a customer return?')?.topic).toBe('return');
    expect(shortGuideAnswer('How do I do a supplier return?', 'en')).toMatch(/Purchases/i);
    expect(shortGuideAnswer('How do I do a supplier return?', 'en')).not.toMatch(/Open Sales/i);
    expect(shortGuideAnswer('كيف بعمل مرتجع مورد؟', 'ar')).toMatch(/مشتريات/i);
  });

  it('5. Financial capability questions refuse policy — not live figures', () => {
    const samples = [
      'Can AI move cash?',
      'Can the AI move cash for me?',
      'Can AI collect customer debt?',
      'Can you pay a supplier?',
      'Can you refund a customer?',
      'Can you complete checkout?',
      'فيني حرك الكاش؟',
      'بتقدر تسدد دين زبون؟',
      'يقدر ال AI يدفع للمورد؟',
    ];
    for (const q of samples) {
      expect(isFinancialCapabilityQuestion(q), q).toBe(true);
      expect(classifyRead(q, 'en'), q).toBeNull();
      const answered = answerQuestion(publishedKnowledge, { ...owner, question: q, lang: /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en' });
      expect(answered.text, q).toMatch(/cannot|ما ب|لا —|No —/i);
      expect(answered.text, q).not.toMatch(/USD:|LBP:|Live data|Current screen/i);
    }
    expect(financeCapabilityRefusalText('en')).toMatch(/cannot execute financial/i);
  });

  it('6. Unavailable features stay honest', () => {
    const a = answerQuestion(publishedKnowledge, { ...owner, question: 'Do you support Shopify loyalty points?' });
    expect(a.status).toBe('unknown');
    expect(a.text).toMatch(/not part of this system|مش موجود/i);
  });

  it('7. No internal paths, callables, or test names in normal answers', () => {
    const questions = [
      'What is Zelvero POS?',
      'Does the owner have all permissions?',
      'How do I find a product?',
      'How do I edit a product?',
      'Can a sub-user grant themselves AI access?',
      'What can I do from the dashboard?',
    ];
    for (const q of questions) {
      const a = answerQuestion(publishedKnowledge, { ...owner, question: q });
      expect(a.text, q).not.toMatch(/\bsrc\//);
      expect(a.text, q).not.toMatch(/\.test\.(?:ts|tsx)\b/);
      expect(a.text, q).not.toMatch(/\bis a Cloud Function\b/);
      expect(a.text, q).not.toMatch(/working tree, not a production/i);
      expect(a.text, q).not.toMatch(/Zelvero AI cannot open it for you/i);
    }
    expect(sanitizeUserFacingText('Hello. This is from the local working tree, not a production deployment check.')).toBe('Hello.');
  });

  it('8. Navigation and short affirmative follow-ups still work', async () => {
    const navigate = vi.fn();
    const open = await handleOperatorTurn('Open products', { ...opCtx, navigate }, null);
    expect(open.handled).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/products');

    const guide = await handleOperatorTurn('How do I add a product?', opCtx, null);
    expect(guide.pending?.kind).toBe('offerNavigate');
    const yes = await handleOperatorTurn('إيه', { ...opCtx, lang: 'ar', navigate: vi.fn() }, guide.pending);
    expect(yes.handled).toBe(true);
    expect(yes.text).toMatch(/فتح|Opened|Products|المنتجات|Add/i);
  });

  it('9. Financial actions stay off the allowlist', () => {
    for (const id of ['checkout', 'refund', 'cashIn', 'cashOut', 'collectDebt', 'paySupplier', 'posReturn'] as const) {
      expect(AI_TOOLS.includes(id as never)).toBe(false);
      expect((AI_FORBIDDEN_ACTIONS as readonly string[]).length).toBeGreaterThan(0);
    }
    expect(isFinancialExecutionRequest('Checkout now')).toBe(true);
  });

  it('10. Permission questions are not live cash/debt reads', () => {
    expect(classifyRead('Which permission opens the cash drawer page?', 'en')).toBeNull();
    expect(classifyRead('Can AI collect customer debt?', 'en')).toBeNull();
    const sell = answerQuestion(publishedKnowledge, { ...owner, question: 'Which permission is required to sell?' });
    expect(sell.text.toLowerCase()).toMatch(/sell|permission|صلاح/i);
    expect(sell.text).not.toMatch(/\bcanSell\b/);
    expect(sell.text).not.toMatch(/Live data|USD:/i);
  });
});
