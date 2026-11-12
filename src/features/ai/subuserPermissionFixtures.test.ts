/**
 * Fixture-only sub-user AI vs POS permission matrix.
 * Mocks product search so cart paths never touch Firestore/Auth.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_FORBIDDEN_ACTIONS,
  AI_TOOLS,
  isForbiddenAction,
} from './actions/allowlist';
import {
  isFinancialExecutionRequest,
  isForbiddenWriteRequest,
  isStockExecutionRequest,
} from './actions/financeGuard';
import { buildNavigateOffer } from './actions/followUp';
import { handleOperatorTurn, type OperatorContext, type PendingOperator } from './actions/operator';
import {
  aiDockModeAfterPermissionChange,
  assertCanAccessZelveroAi,
  canAccessZelveroAi,
  shouldShowAiEntry,
} from './aiAccess';
import {
  allPersonas,
  ownerPersona,
  staffAiNoSellPersona,
  staffAiSellPersona,
  staffNoAiSellPersona,
  type PersonaFixture,
} from './personas.fixtures';
import { loadReadSnapshot, type AiReadSource, type ReadSession } from './readSnapshot';
import { classifyRead } from './readIntent';

vi.mock('./actions/productSearch', () => ({
  extractProductQuery: (q: string) => {
    const m = q.match(/add\s+(.+?)\s+to\s+(?:the\s+)?cart/i);
    return m?.[1]?.trim() || null;
  },
  searchProductsByName: vi.fn(async () => [{ id: 'p1', name: 'Cola', barcode: null }]),
}));

vi.mock('./actions/cartBridge', () => ({
  getPosCartHost: vi.fn(() => null),
}));

vi.mock('./actions/cartOps', async () => {
  const actual = await vi.importActual<typeof import('./actions/cartOps')>('./actions/cartOps');
  return {
    ...actual,
    cartAdd: vi.fn(() => ({ ok: true as const })),
    cartRemoveOne: vi.fn(() => ({ ok: true as const })),
  };
});

function opCtx(persona: PersonaFixture, navigate = vi.fn()): OperatorContext {
  return {
    lang: 'en',
    tenantId: 'fixture-tenant',
    route: '/dashboard',
    isOwner: persona.isOwner,
    can: persona.can,
    navigate,
    label: (key) => key.replace(/^nav\./, ''),
  };
}

function readSession(persona: PersonaFixture): ReadSession {
  return {
    tenantId: 'fixture-tenant',
    route: '/pos',
    isOwner: persona.isOwner,
    can: persona.can,
  };
}

const emptySource: AiReadSource = {
  dailyStats: async () => [],
  cashbox: async () => ({ usdCents: 0, lbp: 0 }),
  products: async () => ({ items: [], hasMore: false }),
  productsByIds: async () => [],
  threshold: async () => 5,
  stockCounts: async () => ({ low: 0, out: 0 }),
  findStock: async () => ({ items: [], complete: true }),
  expiry: async () => ({ expired: 0, soon: 0, soonDays: 30, listed: [], listIncomplete: false }),
  debts: async () => ({ items: [], hasMore: false }),
  saleLines: async () => ({ sales: [], complete: true }),
};

const MONEY_AND_STOCK = [
  'Checkout now',
  'Clear this customer debt now',
  'Collect the debt payment now',
  'Transfer 50 USD to LBP',
  'Set stock to 50',
  'Adjust stock of Widget to 10',
  'Can the AI move cash for me?',
];

describe('persona fixtures — shape', () => {
  it('defines four isolated personas with the required permission splits', () => {
    const [owner, aiSell, noAi, aiNoSell] = allPersonas();
    expect(owner.isOwner).toBe(true);
    expect(owner.perms.canUseZelveroAI).toBe(true);
    expect(owner.perms.canSell).toBe(true);

    expect(aiSell.isOwner).toBe(false);
    expect(aiSell.perms.canUseZelveroAI).toBe(true);
    expect(aiSell.perms.canSell).toBe(true);

    expect(noAi.perms.canUseZelveroAI).toBe(false);
    expect(noAi.perms.canSell).toBe(true);

    expect(aiNoSell.perms.canUseZelveroAI).toBe(true);
    expect(aiNoSell.perms.canSell).toBe(false);
  });
});

describe('AI access by persona', () => {
  it('owner and AI-enabled staff can access AI; AI-disabled cannot', () => {
    expect(canAccessZelveroAi(ownerPersona())).toBe(true);
    expect(shouldShowAiEntry(ownerPersona())).toBe(true);
    expect(assertCanAccessZelveroAi(ownerPersona())).toEqual({ ok: true });

    expect(canAccessZelveroAi(staffAiSellPersona())).toBe(true);
    expect(shouldShowAiEntry(staffAiSellPersona())).toBe(true);

    expect(canAccessZelveroAi(staffAiNoSellPersona())).toBe(true);

    const noAi = staffNoAiSellPersona();
    expect(canAccessZelveroAi(noAi)).toBe(false);
    expect(shouldShowAiEntry(noAi)).toBe(false);
    expect(assertCanAccessZelveroAi(noAi)).toEqual({ ok: false, reason: 'denied' });
  });

  it('direct operator submission cannot bypass AI access', async () => {
    const navigate = vi.fn();
    const denied = await handleOperatorTurn('Open products', opCtx(staffNoAiSellPersona(), navigate), null);
    expect(denied.handled).toBe(true);
    expect(denied.text).toMatch(/do not have permission to use Zelvero AI/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(denied.pending).toBeNull();
  });

  it('AI-enabled staff can submit navigation (handler path)', async () => {
    const navigate = vi.fn();
    const ok = await handleOperatorTurn('Open products', opCtx(staffAiSellPersona(), navigate), null);
    expect(ok.handled).toBe(true);
    expect(ok.text).toMatch(/Opening/i);
    expect(navigate).toHaveBeenCalledWith('/products');
  });
});

describe('POS permission separation', () => {
  it('AI access does not grant canSell', () => {
    const p = staffAiNoSellPersona();
    expect(p.perms.canUseZelveroAI).toBe(true);
    expect(p.perms.canSell).toBe(false);
    expect(p.can('canSell')).toBe(false);
    expect(canAccessZelveroAi(p)).toBe(true);
  });

  it('AI without sell cannot execute cart sales actions', async () => {
    const navigate = vi.fn();
    const denied = await handleOperatorTurn('Add Cola to the cart', opCtx(staffAiNoSellPersona(), navigate), null);
    expect(denied.handled).toBe(true);
    expect(denied.text).toMatch(/permission to sell/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('AI + sell passes the sell gate (mocked catalog; no Firestore)', async () => {
    const navigate = vi.fn();
    const ok = await handleOperatorTurn('Add Cola to the cart', opCtx(staffAiSellPersona(), navigate), null);
    expect(ok.handled).toBe(true);
    expect(ok.text).not.toMatch(/permission to sell/i);
    // Host absent → navigates to POS for confirm, which is allowed for sellers.
    expect(ok.text).toMatch(/Opening POS|Confirm|Cola/i);
  });

  it('owner navigation remains unchanged', async () => {
    const navigate = vi.fn();
    const ok = await handleOperatorTurn('Open products', opCtx(ownerPersona(), navigate), null);
    expect(navigate).toHaveBeenCalledWith('/products');
    expect(ok.text).toMatch(/Opening/i);
  });
});

describe('revocation and pending work', () => {
  it('revoking AI access closes open/minimized dock modes', () => {
    expect(aiDockModeAfterPermissionChange(false, 'open')).toBe('closed');
    expect(aiDockModeAfterPermissionChange(false, 'minimized')).toBe('closed');
    expect(aiDockModeAfterPermissionChange(true, 'open')).toBe('open');
  });

  it('pending navigate offer cannot execute after AI access is revoked', async () => {
    const navigate = vi.fn();
    const pending = buildNavigateOffer('/products', 'sub-fix-1', { openCreateForm: false }) as PendingOperator;
    expect(pending?.kind).toBe('offerNavigate');

    // While AI still granted, affirm would navigate — sanity check with AI staff.
    const allowed = await handleOperatorTurn('yes', opCtx(staffAiSellPersona(), navigate), pending);
    expect(allowed.handled).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/products');

    navigate.mockClear();
    const revoked = await handleOperatorTurn('yes', opCtx(staffNoAiSellPersona(), navigate), pending);
    expect(revoked.handled).toBe(true);
    expect(revoked.text).toMatch(/do not have permission to use Zelvero AI/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(revoked.pending).toBeNull();
  });

  it('live reads refuse when AI access is missing (latest permission state)', async () => {
    const now = new Date(2026, 9, 31, 12, 0, 0);
    const request = classifyRead('How much did we sell today?', 'en', now)!;
    expect(request.topics).toContain('sales');

    const denied = await loadReadSnapshot(readSession(staffNoAiSellPersona()), request, emptySource, now);
    expect(denied.status).toBe('denied');
    expect(denied.text).toMatch(/do not have permission|صلاحية|Zelvero AI/i);
    expect(denied.text).not.toMatch(/Net sales|USD:/i);

    const ownerSnap = await loadReadSnapshot(readSession(ownerPersona()), request, emptySource, now);
    expect(ownerSnap.status).not.toBe('denied');
  });
});

describe('financial and stock safety across personas', () => {
  beforeEach(() => {
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    expect(isForbiddenAction('checkout')).toBe(true);
    expect(AI_FORBIDDEN_ACTIONS).toEqual(expect.arrayContaining(['checkout', 'payDebt', 'adjustStock', 'cashMove']));
  });

  it.each(allPersonas())('$label — money/stock execution refused at operator', async (persona) => {
    // AI-disabled never reaches finance guards; still must not navigate/execute.
    for (const q of MONEY_AND_STOCK) {
      const navigate = vi.fn();
      const result = await handleOperatorTurn(q, opCtx(persona, navigate), null);
      expect(result.handled, `${persona.id}:${q}`).toBe(true);
      expect(navigate, `${persona.id}:${q}`).not.toHaveBeenCalled();
      if (canAccessZelveroAi(persona)) {
        expect(result.text, `${persona.id}:${q}`).toMatch(
          /cannot complete|cannot execute financial|cannot change product stock|No — Zelvero AI cannot/i,
        );
      } else {
        expect(result.text, `${persona.id}:${q}`).toMatch(/do not have permission to use Zelvero AI/i);
      }
      expect(result.text, `${persona.id}:${q}`).not.toMatch(/Live data for this signed-in store/i);
    }
  });

  it('write classifiers still flag stock/debt mutations for every persona context', () => {
    expect(isStockExecutionRequest('Set stock to 50')).toBe(true);
    expect(isFinancialExecutionRequest('Clear this customer debt now')).toBe(true);
    expect(isForbiddenWriteRequest('Set stock to 50')).toBe(true);
    expect(isForbiddenWriteRequest('How much stock of Cola?')).toBe(false);
  });
});
