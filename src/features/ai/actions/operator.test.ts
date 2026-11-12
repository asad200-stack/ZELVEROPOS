import { describe, expect, it, vi } from 'vitest';
import { AI_FORBIDDEN_ACTIONS, AI_TOOLS, isForbiddenAction } from './allowlist';
import { financeRefusalText, isFinancialExecutionRequest } from './financeGuard';
import { canAccessNav, isNavigationRequest, resolveNavigateTarget } from './navigateIntent';
import {
  formatProductPreview,
  isConfirmUtterance,
  missingProductFields,
  parseProductDraft,
  toProductInput,
} from './productDraft';
import { handleOperatorTurn } from './operator';

describe('AI action allowlist', () => {
  it('lists operator capabilities and keeps financial actions forbidden', () => {
    expect(AI_TOOLS).toContain('navigate');
    expect(AI_TOOLS).toContain('draftCreateProduct');
    expect(AI_TOOLS).toContain('cartAdd');
    expect(AI_FORBIDDEN_ACTIONS).toContain('checkout');
    expect(AI_FORBIDDEN_ACTIONS).toContain('processReturn');
    expect(AI_FORBIDDEN_ACTIONS).toContain('cashMove');
    expect(isForbiddenAction('checkout')).toBe(true);
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
  });
});

describe('navigation intent', () => {
  it('resolves Arabic and English open-products commands', () => {
    expect(isNavigationRequest('Open products')).toBe(true);
    expect(isNavigationRequest('Show me products with high stock and low sales')).toBe(false);
    expect(resolveNavigateTarget('Open products')?.path).toBe('/products');
    expect(resolveNavigateTarget('افتح المنتجات')?.path).toBe('/products');
    expect(resolveNavigateTarget('فوتني على صفحة المنتجات')?.path).toBe('/products');
    expect(resolveNavigateTarget('فوتني على كابيتال')?.tab).toBe('capital');
    expect(resolveNavigateTarget('Open capital')?.path).toBe('/reports');
    expect(resolveNavigateTarget('افتح التقارير')?.tab).toBeUndefined();
    expect(isNavigationRequest('فوتني على كابيتال')).toBe(true);
    expect(resolveNavigateTarget('Take me to the returns page')?.path).toBe('/sales');
    expect(isNavigationRequest('How do I add a product?')).toBe(false);
    expect(isNavigationRequest('ورجيني وين بعمل المرتجع')).toBe(false);
  });

  it('respects permissions', () => {
    const products = resolveNavigateTarget('Open products')!;
    expect(canAccessNav(products, { isOwner: false, can: () => false })).toBe(false);
    expect(canAccessNav(products, { isOwner: false, can: (p) => p === 'canViewProducts' })).toBe(true);
  });
});

describe('product draft conversation', () => {
  it('parses name and price and asks for missing fields', () => {
    const draft = parseProductDraft('Add a new product called PlayStation 5, price $500');
    expect(draft.name).toBe('PlayStation 5');
    expect(draft.retailUsdCents).toBe(50000);
    expect(missingProductFields(draft)).toEqual([]);
    expect(toProductInput(draft)?.initialStock).toBe(0);
  });

  it('requires confirmation text before create payload is complete', () => {
    expect(isConfirmUtterance('Confirm')).toBe(true);
    expect(isConfirmUtterance('تأكيد')).toBe(true);
    expect(isConfirmUtterance('maybe')).toBe(false);
    const preview = formatProductPreview({ name: 'PS5', retailUsdCents: 50000 }, 'en');
    expect(preview).toContain('Confirm');
    expect(preview).not.toMatch(/posCreateProduct|functions\//);
  });
});

describe('financial refusal', () => {
  it('refuses checkout and cash moves but allows how-to questions', () => {
    expect(isFinancialExecutionRequest('Checkout now')).toBe(true);
    expect(isFinancialExecutionRequest('Process the return')).toBe(true);
    expect(isFinancialExecutionRequest('How do I checkout?')).toBe(false);
    expect(financeRefusalText('en')).toMatch(/cannot complete checkout/i);
  });
});

function opCtx(
  overrides: Partial<{
    lang: 'en' | 'ar';
    tenantId: string | null;
    route: string;
    isOwner: boolean;
    can: (p: string) => boolean;
    navigate: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const baseCan = overrides.can ?? (() => true);
  return {
    lang: overrides.lang ?? ('en' as const),
    tenantId: overrides.tenantId ?? 't1',
    route: overrides.route ?? '/dashboard',
    isOwner: overrides.isOwner ?? false,
    can: (p: string) => p === 'canUseZelveroAI' || baseCan(p),
    navigate: (overrides.navigate ?? vi.fn()) as (path: string) => void,
    label: (key: string) => key,
  };
}

describe('handleOperatorTurn', () => {
  it('rejects before processing when canUseZelveroAI is denied', async () => {
    const navigate = vi.fn();
    const denied = await handleOperatorTurn(
      'Open products',
      {
        lang: 'en',
        tenantId: 't1',
        route: '/dashboard',
        isOwner: false,
        can: () => false,
        navigate,
        label: (key) => key,
      },
      null,
    );
    expect(denied.handled).toBe(true);
    expect(denied.pending).toBeNull();
    expect(denied.text).toMatch(/do not have permission to use Zelvero AI/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('proceeds when AI access is granted or the caller is an owner', async () => {
    const navigate = vi.fn();
    const withAi = await handleOperatorTurn(
      'Open products',
      opCtx({ can: (p) => p === 'canViewProducts', navigate }),
      null,
    );
    expect(withAi.text).toMatch(/Opening/i);
    expect(navigate).toHaveBeenCalledWith('/products');

    const ownerNav = vi.fn();
    const owner = await handleOperatorTurn(
      'Open products',
      {
        lang: 'en',
        tenantId: 't1',
        route: '/dashboard',
        isOwner: true,
        can: () => true,
        navigate: ownerNav,
        label: (key) => key,
      },
      null,
    );
    expect(owner.text).toMatch(/Opening/i);
    expect(ownerNav).toHaveBeenCalledWith('/products');
  });

  it('keeps POS permission checks after AI access is granted', async () => {
    const navigate = vi.fn();
    const deniedPos = await handleOperatorTurn(
      'Open products',
      opCtx({ can: () => false, navigate }),
      null,
    );
    expect(deniedPos.handled).toBe(true);
    expect(deniedPos.text).toMatch(/permission/i);
    expect(deniedPos.text).not.toMatch(/Zelvero AI/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates when permitted and refuses when not', async () => {
    const navigate = vi.fn();
    const ok = await handleOperatorTurn(
      'Open products',
      opCtx({ can: (p) => p === 'canViewProducts', navigate }),
      null,
    );
    expect(ok.handled).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(ok.text).toMatch(/Opening/i);

    const denied = await handleOperatorTurn(
      'Open products',
      opCtx({ can: () => false, navigate }),
      null,
    );
    expect(denied.handled).toBe(true);
    expect(denied.text).toMatch(/permission/i);
  });

  it('builds a product draft and waits for confirm without calling create yet', async () => {
    const result = await handleOperatorTurn(
      'Add a new product called PlayStation 5, price $500',
      {
        lang: 'en',
        tenantId: 't1',
        route: '/products',
        isOwner: true,
        can: () => true,
        navigate: vi.fn(),
        label: (key) => key,
      },
      null,
    );
    expect(result.handled).toBe(true);
    expect(result.pending?.kind).toBe('createProduct');
    expect(result.text).toMatch(/Product draft/i);
  });

  it('fills a restated product sentence instead of asking for the name again', async () => {
    const sentence = 'add a product named iphone 18 pro\ncost 1700$\nquantity 100\nprices 2000$';
    const ctx = {
      lang: 'en' as const,
      tenantId: 't1',
      route: '/products',
      isOwner: true,
      can: () => true,
      navigate: vi.fn(),
      label: (key: string) => key,
    };
    const first = await handleOperatorTurn(sentence, ctx, null);
    expect(first.text).not.toMatch(/What is the product name/i);
    expect(first.pending?.kind).toBe('createProduct');
    if (first.pending?.kind === 'createProduct') {
      expect(first.pending.draft.name).toBe('iphone 18 pro');
      expect(first.pending.draft.costUsdCents).toBe(170_000);
      expect(first.pending.draft.initialStock).toBe(100);
      expect(first.pending.draft.retailUsdCents).toBe(200_000);
    }
    const again = await handleOperatorTurn(sentence, ctx, first.pending);
    expect(again.text).not.toMatch(/draft is pending/i);
    expect(again.text).not.toMatch(/What is the product name/i);
    expect(again.text).not.toMatch(/Wholesale|VIP/i);
    expect(again.pending?.kind).toBe('createProduct');
    if (again.pending?.kind === 'createProduct') {
      expect(again.pending.draft.name).toBe('iphone 18 pro');
      expect(again.pending.draft.retailUsdCents).toBe(200_000);
      expect(again.pending.draft.wholesaleUsdCents).toBeUndefined();
      expect(again.pending.draft.vipUsdCents).toBeUndefined();
    }

    const dirty = {
      kind: 'createProduct' as const,
      draft: { wholesaleUsdCents: 0, vipUsdCents: 0, retailUsdCents: 1 },
      submissionId: 'stale',
    };
    const replaced = await handleOperatorTurn(sentence, ctx, dirty);
    expect(replaced.text).not.toMatch(/Wholesale: \$0\.00|VIP: \$0\.00/);
    if (replaced.pending?.kind === 'createProduct') {
      expect(replaced.pending.draft.wholesaleUsdCents).toBeUndefined();
      expect(replaced.pending.draft.vipUsdCents).toBeUndefined();
      expect(replaced.pending.draft.name).toBe('iphone 18 pro');
    }
    const withBarcode = await handleOperatorTurn('barcode 0000', ctx, replaced.pending);
    expect(withBarcode.text).toMatch(/Barcode: 0000/);
    expect(withBarcode.text).not.toMatch(/Wholesale|VIP/);
    if (withBarcode.pending?.kind === 'createProduct') {
      expect(withBarcode.pending.draft.barcode).toBe('0000');
      expect(withBarcode.pending.draft.retailUsdCents).toBe(200_000);
      expect(withBarcode.pending.draft.wholesaleUsdCents).toBeUndefined();
    }
  });

  it('cancels a pending product draft', async () => {
    const cancelled = await handleOperatorTurn(
      'Cancel',
      {
        lang: 'en',
        tenantId: 't1',
        route: '/products',
        isOwner: true,
        can: () => true,
        navigate: vi.fn(),
        label: (key) => key,
      },
      { kind: 'createProduct', draft: { name: 'X', retailUsdCents: 100 }, submissionId: 's1' },
    );
    expect(cancelled.pending).toBeNull();
    expect(cancelled.text).toMatch(/Cancelled/i);
  });

  it('refuses financial execution', async () => {
    const result = await handleOperatorTurn(
      'Collect payment now',
      {
        lang: 'en',
        tenantId: 't1',
        route: '/pos',
        isOwner: true,
        can: () => true,
        navigate: vi.fn(),
        label: (key) => key,
      },
      null,
    );
    expect(result.handled).toBe(true);
    expect(result.text).toMatch(/cannot complete/i);
  });
});
