import { describe, expect, it, vi } from 'vitest';
import { shortGuideAnswer } from './guide';
import { isNavigationRequest, resolveNavigateTarget } from './navigateIntent';
import { handleOperatorTurn } from './operator';
import { classifyOperatorIntent, isExecuteCartAdd, isExecuteCreateProduct, isGuideIntent } from './operatorIntent';
import { isCreateProductRequest } from './productDraft';

const ctx = {
  lang: 'en' as const,
  tenantId: 't1',
  route: '/dashboard',
  isOwner: true,
  can: () => true,
  navigate: vi.fn(),
  label: (key: string) => key.replace(/^nav\./, ''),
};

describe('intent separation: guide vs navigate vs execute', () => {
  it('1. How do I add a product? → guide (not draft)', async () => {
    expect(isGuideIntent('How do I add a product?')).toBe(true);
    expect(isCreateProductRequest('How do I add a product?')).toBe(false);
    expect(classifyOperatorIntent('How do I add a product?')).toBe('guide');
    const result = await handleOperatorTurn('How do I add a product?', ctx, null);
    expect(result.handled).toBe(true);
    expect(result.pending?.kind).toBe('offerNavigate');
    expect(result.pending && result.pending.kind === 'offerNavigate' && result.pending.path).toBe('/products');
    expect(result.text).toMatch(/1\.\s*Open the Products page/i);
    expect(result.text).not.toMatch(/What is the product name/i);
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('2. كيف بضيف منتج؟ → guide', async () => {
    expect(classifyOperatorIntent('كيف بضيف منتج؟')).toBe('guide');
    expect(isExecuteCreateProduct('كيف بضيف منتج؟')).toBe(false);
    const result = await handleOperatorTurn('كيف بضيف منتج؟', { ...ctx, lang: 'ar' }, null);
    expect(result.pending?.kind).toBe('offerNavigate');
    expect(result.text).toContain('1. افتح صفحة المنتجات');
    expect(result.text).not.toMatch(/شو اسم المنتج/);
  });

  it('3. Open products. → navigate', async () => {
    const navigate = vi.fn();
    expect(isNavigationRequest('Open products.')).toBe(true);
    expect(classifyOperatorIntent('Open products.')).not.toBe('createProduct');
    const result = await handleOperatorTurn('Open products.', { ...ctx, navigate }, null);
    expect(result.pending).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(result.text).toMatch(/Opening/i);
  });

  it('4. فوتني على صفحة المنتجات. → navigate', async () => {
    const navigate = vi.fn();
    expect(resolveNavigateTarget('فوتني على صفحة المنتجات.')?.path).toBe('/products');
    const result = await handleOperatorTurn('فوتني على صفحة المنتجات.', { ...ctx, lang: 'ar', navigate }, null);
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(result.pending).toBeNull();
    expect(result.text).not.toMatch(/شو اسم المنتج|سعر البيع/);
  });

  it('5. Add a new product. → product draft', async () => {
    expect(classifyOperatorIntent('Add a new product.')).toBe('createProduct');
    const result = await handleOperatorTurn('Add a new product.', ctx, null);
    expect(result.pending?.kind).toBe('createProduct');
    expect(result.text).toMatch(/What is the product name\?/i);
  });

  it('6. ضيفلي منتج جديد. → product draft', async () => {
    expect(classifyOperatorIntent('ضيفلي منتج جديد.')).toBe('createProduct');
    const result = await handleOperatorTurn('ضيفلي منتج جديد.', { ...ctx, lang: 'ar' }, null);
    expect(result.pending?.kind).toBe('createProduct');
    expect(result.text).toMatch(/شو اسم المنتج/);
  });

  it('5b. everyday add-item phrasing starts a product draft, not a generic miss', async () => {
    for (const phrase of ['i need to add an item', 'I want to add an item', 'add an item', 'بدي أضيف صنف']) {
      expect(classifyOperatorIntent(phrase)).toBe('createProduct');
      expect(isGuideIntent(phrase)).toBe(false);
    }
    const result = await handleOperatorTurn('i need to add an item', ctx, null);
    expect(result.handled).toBe(true);
    expect(result.pending?.kind).toBe('createProduct');
    expect(result.text).toMatch(/What is the product name\?/i);
    expect(result.text).not.toMatch(/What do you want to do or know/i);
  });

  it('5c. how-to item phrasing stays a guide', async () => {
    expect(classifyOperatorIntent('How do I add an item?')).toBe('guide');
    const result = await handleOperatorTurn('How do I add an item?', ctx, null);
    expect(result.pending?.kind).toBe('offerNavigate');
    expect(result.text).toMatch(/1\.\s*Open the Products page/i);
  });

  it('5d. customer, supplier, and purchase paraphrases stay on those actions', () => {
    expect(classifyOperatorIntent('I need to add a client')).toBe('createCustomer');
    expect(classifyOperatorIntent('I want to add a vendor')).toBe('createSupplier');
    expect(classifyOperatorIntent('I need to add a purchase')).toBe('createPurchase');
    expect(classifyOperatorIntent('add an item to the cart')).toBe('cartAdd');
  });

  it('7. Add PS5 to the cart. → cart action', async () => {
    expect(isExecuteCartAdd('Add PS5 to the cart.')).toBe(true);
    expect(classifyOperatorIntent('Add PS5 to the cart.')).toBe('cartAdd');
    expect(classifyOperatorIntent('Add a product to the cart')).toBe('cartAdd');
    expect(isCreateProductRequest('Add PS5 to the cart.')).toBe(false);
    expect(isCreateProductRequest('Add a product to the cart')).toBe(false);
  });

  it('8. حطلي PS5 بالكارت. → cart action', async () => {
    expect(classifyOperatorIntent('حطلي PS5 بالكارت.')).toBe('cartAdd');
    expect(isGuideIntent('حطلي PS5 بالكارت.')).toBe(false);
  });

  it('9. How do I process a return? → guide', async () => {
    expect(classifyOperatorIntent('How do I process a return?')).toBe('guide');
    const result = await handleOperatorTurn('How do I process a return?', ctx, null);
    expect(result.pending?.kind).toBe('offerNavigate');
    expect(result.pending && result.pending.kind === 'offerNavigate' && result.pending.path).toBe('/sales');
    expect(result.text).toMatch(/1\.\s*Open Sales/i);
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('9b. Supplier return ≠ customer return', async () => {
    const supplier = await handleOperatorTurn('How do I do a supplier return?', ctx, null);
    expect(supplier.text).toMatch(/Purchases/i);
    expect(supplier.text).not.toMatch(/Open Sales/i);
    expect(supplier.pending && supplier.pending.kind === 'offerNavigate' && supplier.pending.path).toBe('/purchases');
  });

  it('10. Take me to returns. → navigate', async () => {
    const navigate = vi.fn();
    expect(isNavigationRequest('Take me to returns.')).toBe(true);
    expect(resolveNavigateTarget('Take me to returns.')?.path).toBe('/sales');
    const result = await handleOperatorTurn('Take me to returns.', { ...ctx, navigate }, null);
    expect(navigate).toHaveBeenCalledWith('/sales');
    expect(result.pending).toBeNull();
  });

  it('guide never continues a pending product draft or executes it', async () => {
    const pending = {
      kind: 'createProduct' as const,
      draft: { name: 'PS5', retailUsdCents: 50000 },
      submissionId: 's1',
    };
    const result = await handleOperatorTurn('How do I add a product?', ctx, pending);
    expect(result.pending?.kind).toBe('offerNavigate');
    expect(result.text).toMatch(/1\.\s*Open the Products page/i);
    expect(result.text).toMatch(/Paused the previous operation/i);
    expect(result.text).not.toMatch(/Created product/i);
  });

  it('Arabic teach-me phrases stay on guide', () => {
    for (const q of ['علّمني كيف أضيف منتج', 'بدي أعرف طريقة إضافة منتج', 'كيف بعمل مرتجع؟', 'ورجيني وين بعمل المرتجع']) {
      expect(classifyOperatorIntent(q), q).toBe('guide');
      expect(isExecuteCreateProduct(q), q).toBe(false);
      expect(shortGuideAnswer(q, 'ar')).toBeTruthy();
    }
  });

  it('how to add customer/supplier → guide offer with create form, not navigate-now', async () => {
    const navigate = vi.fn();
    for (const [q, path] of [
      ['How do I add a customer?', '/customers'],
      ['كيف بضيف مورد؟', '/suppliers'],
    ] as const) {
      const result = await handleOperatorTurn(q, { ...ctx, lang: /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', navigate }, null);
      expect(classifyOperatorIntent(q), q).toBe('guide');
      expect(result.pending?.kind, q).toBe('offerNavigate');
      expect(result.pending && result.pending.kind === 'offerNavigate' && result.pending.path, q).toBe(path);
      expect(result.pending && result.pending.kind === 'offerNavigate' && result.pending.openCreateForm, q).toBe(true);
      expect(navigate, q).not.toHaveBeenCalled();
    }
  });
});
