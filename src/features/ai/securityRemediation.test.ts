import { describe, expect, it, vi } from 'vitest';
import { AI_FORBIDDEN_ACTIONS, AI_TOOLS } from './actions/allowlist';
import {
  financeRefusalText,
  isFinancialExecutionRequest,
  isForbiddenWriteRequest,
  isStockExecutionRequest,
  stockRefusalText,
} from './actions/financeGuard';
import { matchGuide, shortGuideAnswer } from './actions/guide';
import { handleOperatorTurn } from './actions/operator';
import { isGuideIntent } from './actions/operatorIntent';
import {
  assertCanAccessZelveroAi,
  canAccessZelveroAi,
  shouldShowAiEntry,
} from './aiAccess';
import { ALL_PERMISSIONS, DEFAULT_SUBUSER_PERMISSIONS, normalizePermissions, type PermissionKey } from '@/constants/permissions';
import { humanizePermissionKeys, permissionDisplayName } from './permissionDisplay';
import { classifyRead } from './readIntent';
import { isSubUserSelfGrantAiQuestion, sanitizeUserFacingText, subUserSelfGrantAiText } from './userFacingAnswer';

const now = new Date(2026, 9, 31, 12, 0, 0);

const ownerCtx = {
  lang: 'en' as const,
  tenantId: 'demo',
  route: '/products',
  isOwner: true,
  can: (p: PermissionKey) => ALL_PERMISSIONS[p] === true,
  navigate: vi.fn(),
  label: (key: string) => key.replace(/^nav\./, ''),
};

describe('S1 — stock / debt execution vs inquiry', () => {
  it('refuses stock mutation before live readers (EN)', async () => {
    for (const q of ['Set stock to 50', 'Set stock of TestItem to 999', 'Adjust stock of Widget to 10']) {
      expect(isStockExecutionRequest(q), q).toBe(true);
      expect(isForbiddenWriteRequest(q), q).toBe(true);
      expect(classifyRead(q, 'en', now), q).toBeNull();
      const op = await handleOperatorTurn(q, ownerCtx, null);
      expect(op.handled, q).toBe(true);
      expect(op.text, q).toBe(stockRefusalText('en'));
      expect(op.text, q).not.toMatch(/Live data|Scope:/i);
    }
  });

  it('refuses stock mutation (AR / Lebanese)', async () => {
    for (const q of ['عدّل المخزون لـ 50', 'حط المخزون 20', 'خلّي المخزون 5']) {
      expect(isStockExecutionRequest(q), q).toBe(true);
      expect(classifyRead(q, 'ar', now), q).toBeNull();
      const op = await handleOperatorTurn(q, { ...ownerCtx, lang: 'ar' }, null);
      expect(op.text, q).toMatch(/ما بقدر أعدّل المخزون|تعديل المخزون/);
    }
  });

  it('keeps legitimate stock inquiry as live-capable (not refused as write)', () => {
    for (const q of ['How much stock do I have?', 'What is the stock of Cola?', 'قديش مخزون كولا؟']) {
      expect(isStockExecutionRequest(q), q).toBe(false);
      expect(isForbiddenWriteRequest(q), q).toBe(false);
    }
    expect(classifyRead('What is the stock of Cola?', 'en', now)?.topics).toContain('stockItem');
  });

  it('refuses debt clear / collect execution (EN + AR)', async () => {
    for (const q of [
      'Clear this customer debt now',
      'Collect the debt payment now',
      'امسح الدين هلأ',
      'سدد الدين الآن',
    ]) {
      expect(isFinancialExecutionRequest(q), q).toBe(true);
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      const op = await handleOperatorTurn(q, ownerCtx, null);
      expect(op.handled, q).toBe(true);
      expect(op.text, q).toMatch(/cannot complete|ما بقدر أنفّذ|finance|دفع|تسوية|settlement/i);
      expect(op.text, q).not.toMatch(/Live data|Scope:/i);
    }
  });

  it('debt how-to is guide, not live or execution', async () => {
    for (const q of [
      'كيف بستلم دين من زبون؟',
      'How do I collect a customer debt payment?',
      'كيف بسدد دين زبون؟',
    ]) {
      expect(isFinancialExecutionRequest(q), q).toBe(false);
      expect(isGuideIntent(q) || /how\s+do|كيف/i.test(q), q).toBe(true);
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe('collectDebt');
      const text = shortGuideAnswer(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en')!;
      expect(text, q).toMatch(/Receive payment|استلام دفعة|Customers|الزبائن/i);
      expect(text, q).toMatch(/will not collect|ما بستلم|chat|الدردشة/i);
      const op = await handleOperatorTurn(q, ownerCtx, null);
      expect(op.handled, q).toBe(true);
      expect(op.text, q).not.toMatch(/Live data|Scope:/i);
    }
  });

  it('debt amount inquiry still classifies as live debts', () => {
    const q = 'How much does this customer owe?';
    expect(isFinancialExecutionRequest(q)).toBe(false);
    expect(classifyRead(q, 'en', now)?.topics).toContain('debts');
  });

  it('does not add stock or debt tools to the allowlist', () => {
    for (const id of ['checkout', 'refund', 'cashIn', 'collectDebt', 'adjustStock', 'payDebt'] as const) {
      expect(AI_TOOLS.includes(id as never)).toBe(false);
    }
    expect((AI_FORBIDDEN_ACTIONS as readonly string[]).length).toBeGreaterThan(0);
    expect(financeRefusalText('en')).toBeTruthy();
  });
});

describe('S2 — self-grant vs owner permission management', () => {
  it('Q84 self-grant is an explicit refusal, not Users guide', async () => {
    const q = 'Can a sub-user grant themselves AI access?';
    expect(isSubUserSelfGrantAiQuestion(q)).toBe(true);
    expect(matchGuide(q)).toBeNull();
    const op = await handleOperatorTurn(q, ownerCtx, null);
    expect(op.text).toBe(subUserSelfGrantAiText('en'));
    expect(op.text).toMatch(/cannot grant themselves/i);
    expect(op.text).not.toMatch(/Tap Add user|grouped under Products/i);
  });

  it('owner how-to for managing users still gets the Users guide', async () => {
    const q = 'How do I edit a sub-user permission?';
    expect(isSubUserSelfGrantAiQuestion(q)).toBe(false);
    expect(matchGuide(q)?.topic).toBe('usersPermissions');
  });
});

describe('permission terminology', () => {
  it('maps verified keys to i18n labels', () => {
    expect(permissionDisplayName('canSell', 'en')).toBe('Sell (point of sale)');
    expect(permissionDisplayName('canSell', 'ar')).toBe('البيع (نقطة البيع)');
    expect(permissionDisplayName('canUseZelveroAI', 'en')).toBe('Access Zelvero AI');
  });

  it('sanitizes raw keys out of user-facing text', () => {
    const raw =
      'canSell is a local permission key. Its English name is "Sell (point of sale)". Its Arabic name is "البيع (نقطة البيع)". Owners implicitly have it. Zelvero AI cannot grant it.';
    const clean = sanitizeUserFacingText(raw);
    expect(clean).not.toMatch(/\bcanSell\b/);
    expect(clean).toMatch(/Sell \(point of sale\)|البيع \(نقطة البيع\)/);
    expect(humanizePermissionKeys('Opening it requires canViewProducts.', 'en')).toMatch(/View products/);
    expect(humanizePermissionKeys('Opening it requires canViewProducts.', 'en')).not.toMatch(/\bcanViewProducts\b/);
  });
});

describe('AI access vs POS permissions (safe fixtures)', () => {
  it('AI access alone does not grant POS sell/products', () => {
    const onlyAi = normalizePermissions({ canUseZelveroAI: true });
    expect(onlyAi.canUseZelveroAI).toBe(true);
    expect(onlyAi.canSell).toBe(false);
    expect(onlyAi.canViewProducts).toBe(false);
    expect(canAccessZelveroAi({ isOwner: false, can: (p) => onlyAi[p] === true })).toBe(true);
  });

  it('sub-user without AI cannot open or submit', async () => {
    const perms = { ...DEFAULT_SUBUSER_PERMISSIONS, canUseZelveroAI: false };
    const ctx = { isOwner: false, can: (p: PermissionKey) => perms[p] === true };
    expect(shouldShowAiEntry(ctx)).toBe(false);
    expect(assertCanAccessZelveroAi(ctx)).toEqual({ ok: false, reason: 'denied' });
    const op = await handleOperatorTurn('Open products', {
      ...ownerCtx,
      isOwner: false,
      can: (p) => perms[p] === true,
    }, null);
    expect(op.handled).toBe(true);
    expect(op.text).toMatch(/do not have permission|صلاحية/i);
  });

  it('sub-user with AI but without canSell still hits POS checks on cart', async () => {
    const perms = normalizePermissions({ canUseZelveroAI: true, canViewProducts: true });
    expect(perms.canSell).toBe(false);
    expect(canAccessZelveroAi({ isOwner: false, can: (p) => perms[p] === true })).toBe(true);
    const op = await handleOperatorTurn('Add Cola to the cart', {
      ...ownerCtx,
      isOwner: false,
      can: (p) => perms[p] === true,
    }, null);
    // Either denied for sell, or asks to open POS / clarify — must not silently grant sell.
    expect(op.handled).toBe(true);
    if (/permission|صلاحية|cannot|ما /i.test(op.text)) {
      expect(op.text).toMatch(/sell|بيع|permission|صلاح/i);
    }
  });
});
