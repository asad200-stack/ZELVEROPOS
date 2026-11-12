import { describe, expect, it, vi } from 'vitest';
import { buildNavigateOffer, isSoftAffirmative, isSoftNegative } from './followUp';
import { handleOperatorTurn } from './operator';

function baseCtx(navigate = vi.fn(), can: (p: string) => boolean = () => true, lang: 'en' | 'ar' = 'en') {
  return {
    lang,
    tenantId: 't1',
    route: '/dashboard',
    isOwner: false,
    // Grant AI access by default; POS checks stay with the provided `can`.
    can: (p: string) => p === 'canUseZelveroAI' || can(p),
    navigate,
    label: (key: string) => key.replace(/^nav\./, ''),
  };
}

describe('conversational follow-up offers', () => {
  it('1. offer open products → إيه → navigate', async () => {
    const navigate = vi.fn();
    const guided = await handleOperatorTurn('كيف بضيف منتج؟', baseCtx(navigate, (p) => p === 'canViewProducts', 'ar'), null);
    expect(guided.pending?.kind).toBe('offerNavigate');
    expect(guided.pending && guided.pending.kind === 'offerNavigate' && guided.pending.openCreateForm).toBe(true);
    const yes = await handleOperatorTurn(
      'إيه',
      baseCtx(navigate, (p) => p === 'canViewProducts' || p === 'canAddProducts', 'ar'),
      guided.pending,
    );
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(yes.pending).toBeNull();
    expect(yes.text).toMatch(/نموذج إضافة منتج|Add product form/i);
    expect(yes.text).not.toMatch(/ما عندي جواب|product name|اسم المنتج|verified/i);
  });

  it('2. same with نعم / أكيد / yes', async () => {
    for (const reply of ['نعم', 'أكيد', 'yes']) {
      const navigate = vi.fn();
      const can = (p: string) => p === 'canViewProducts' || p === 'canAddProducts';
      const guided = await handleOperatorTurn('How do I add a product?', baseCtx(navigate, can), null);
      const result = await handleOperatorTurn(reply, baseCtx(navigate, can), guided.pending);
      expect(navigate, reply).toHaveBeenCalledWith('/products');
      expect(result.text, reply).toMatch(/Add product form|نموذج إضافة منتج/i);
      expect(result.pending, reply).toBeNull();
    }
  });

  it('open products only does not queue Add product form', async () => {
    const navigate = vi.fn();
    const result = await handleOperatorTurn('Open products.', baseCtx(navigate, (p) => p === 'canViewProducts'), null);
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(result.text).not.toMatch(/Add product form|نموذج إضافة منتج/i);
    expect(result.pending).toBeNull();
  });

  it('add a new product opens products and requests create form', async () => {
    const navigate = vi.fn();
    const result = await handleOperatorTurn('ضيفلي منتج جديد.', { ...baseCtx(navigate, () => true, 'ar'), isOwner: true }, null);
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(result.text).toMatch(/نموذج إضافة منتج/);
    expect(result.pending?.kind).toBe('createProduct');
  });

  it('3. offer → لا → no navigation', async () => {
    const navigate = vi.fn();
    const guided = await handleOperatorTurn('كيف بضيف منتج؟', baseCtx(navigate, (p) => p === 'canViewProducts', 'ar'), null);
    const no = await handleOperatorTurn('لا', baseCtx(navigate, (p) => p === 'canViewProducts', 'ar'), guided.pending);
    expect(navigate).not.toHaveBeenCalled();
    expect(no.pending).toBeNull();
    expect(no.text).toMatch(/ما فتحت|did not open/i);
  });

  it('4. no pending + إيه → ask meaning; do not fall through', async () => {
    const result = await handleOperatorTurn('إيه', baseCtx(vi.fn(), () => true, 'ar'), null);
    expect(result.handled).toBe(true);
    expect(result.text).toMatch(/شو قصدك|What did you mean/i);
    expect(result.pending).toBeNull();
  });

  it('5. pending offer + unrelated question → clear offer and answer new question', async () => {
    const navigate = vi.fn();
    const guided = await handleOperatorTurn('How do I add a product?', baseCtx(navigate, (p) => p === 'canViewProducts'), null);
    expect(guided.pending?.kind).toBe('offerNavigate');
    const next = await handleOperatorTurn('Open sales', baseCtx(navigate, (p) => p === 'canViewSales' || p === 'canViewProducts'), guided.pending);
    expect(next.pending).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/sales');
    expect(next.text).toMatch(/Opening/i);
  });

  it('6. pending offer + ambiguous reply → clarification', async () => {
    const guided = await handleOperatorTurn('How do I add a product?', baseCtx(vi.fn(), (p) => p === 'canViewProducts'), null);
    const result = await handleOperatorTurn('maybe', baseCtx(vi.fn(), (p) => p === 'canViewProducts'), guided.pending);
    expect(result.pending?.kind).toBe('offerNavigate');
    expect(result.text).toMatch(/yes or no|بنعم أو لا/i);
  });

  it('7. permission revoked after offer → do not navigate', async () => {
    const navigate = vi.fn();
    const offer = buildNavigateOffer('/products', 's1');
    const result = await handleOperatorTurn('yes', baseCtx(navigate, () => false), offer);
    expect(navigate).not.toHaveBeenCalled();
    expect(result.pending).toBeNull();
    expect(result.text).toMatch(/permission/i);
  });

  it('8. affirmative never triggers a financial action', async () => {
    expect(isSoftAffirmative('إيه')).toBe(true);
    expect(isSoftNegative('لا')).toBe(true);
    const offer = buildNavigateOffer('/products', 's1');
    const result = await handleOperatorTurn('yes', baseCtx(vi.fn(), (p) => p === 'canViewProducts'), offer);
    expect(result.text).not.toMatch(/checkout|payment|refund|cash move|settlement/i);
    const finance = await handleOperatorTurn('Checkout now', baseCtx(), offer);
    expect(finance.text).toMatch(/cannot complete checkout/i);
    expect(finance.pending).toBeNull();
  });

  it('how to add customer → إيه opens customers + create form', async () => {
    const navigate = vi.fn();
    const can = (p: string) => p === 'canViewCustomers';
    const guided = await handleOperatorTurn('كيف بضيف زبون؟', baseCtx(navigate, can, 'ar'), null);
    expect(guided.pending?.kind).toBe('offerNavigate');
    expect(guided.pending && guided.pending.kind === 'offerNavigate' && guided.pending.openCreateForm).toBe(true);
    expect(guided.pending && guided.pending.kind === 'offerNavigate' && guided.pending.path).toBe('/customers');
    const yes = await handleOperatorTurn('إيه', baseCtx(navigate, can, 'ar'), guided.pending);
    expect(navigate).toHaveBeenCalledWith('/customers');
    expect(yes.text).toMatch(/نموذج إضافة زبون|Add customer form/i);
  });

  it('add supplier opens suppliers + create form', async () => {
    const navigate = vi.fn();
    const result = await handleOperatorTurn('ضيفلي مورد جديد.', { ...baseCtx(navigate, () => true, 'ar'), isOwner: true }, null);
    expect(navigate).toHaveBeenCalledWith('/suppliers');
    expect(result.text).toMatch(/نموذج إضافة مورد|Add supplier form/i);
    expect(result.pending).toBeNull();
  });

  it('new purchase opens purchases + create form', async () => {
    const navigate = vi.fn();
    const result = await handleOperatorTurn(
      'فاتورة شراء جديدة',
      baseCtx(navigate, (p) => p === 'canViewSuppliers', 'ar'),
      null,
    );
    expect(navigate).toHaveBeenCalledWith('/purchases');
    expect(result.text).toMatch(/فاتورة شراء|New purchase form/i);
  });

  it('open customers alone does not open create form', async () => {
    const navigate = vi.fn();
    const result = await handleOperatorTurn('افتح الزبائن', baseCtx(navigate, (p) => p === 'canViewCustomers', 'ar'), null);
    expect(navigate).toHaveBeenCalledWith('/customers');
    expect(result.text).not.toMatch(/نموذج|form/i);
  });
});
