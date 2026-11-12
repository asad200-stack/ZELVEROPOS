import { describe, expect, it, vi } from 'vitest';
import { AI_TOOLS } from './actions/allowlist';
import { isFinancialCapabilityQuestion, isFinancialExecutionRequest } from './actions/financeGuard';
import { matchGuide, shortGuideAnswer } from './actions/guide';
import { handleOperatorTurn } from './actions/operator';
import { classifyRead } from './readIntent';

const now = new Date(2026, 9, 31, 12, 0, 0);
const opCtx = {
  lang: 'en' as const,
  tenantId: 't1',
  route: '/dashboard',
  isOwner: true,
  can: () => true,
  navigate: vi.fn(),
  label: (key: string) => key.replace(/^nav\./, ''),
};

const INTERNAL_LEAK = /src\/|\.test\.(?:ts|tsx)|Cloud Function|posImportProducts|canImportProducts|canExportProducts|canEditProducts|canViewReports|working tree/i;

describe('P2 quality guides: five how-to topics', () => {
  it('import/export how-tos are practical and not live', () => {
    for (const q of [
      'How do I import products?',
      'How do I export products to CSV?',
      'كيف بعمل استيراد منتجات؟',
      'كيف بصدّر CSV؟',
    ]) {
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe('importExport');
      const text = shortGuideAnswer(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en')!;
      expect(text, q).toMatch(/csv|CSV|استيراد|تصدير/i);
      expect(text, q).toMatch(/1\.|1\)/);
      expect(text, q).not.toMatch(INTERNAL_LEAK);
      expect(text, q).not.toMatch(/Live data|USD:/i);
    }
  });

  it('categories how-tos describe Products modal workflow', () => {
    for (const q of ['How do I manage product categories?', 'كيف بضيف تصنيف؟', 'وين التصنيفات؟']) {
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe('categories');
      const text = shortGuideAnswer(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en')!;
      expect(text, q).toMatch(/Categories|التصنيفات|Products|المنتجات/i);
      expect(text, q).toMatch(/no separate Categories page|ما في صفحة تصنيفات منفصلة/i);
      expect(text, q).not.toMatch(INTERNAL_LEAK);
    }
  });

  it('credit limit how-tos stay on customers workflow, not live debt', () => {
    for (const q of [
      'How do customer credit limits work?',
      'How do I set a credit limit?',
      'كيف بحدد سقف الدين؟',
      'شو يعني سقف الدين؟',
    ]) {
      expect(isFinancialCapabilityQuestion(q), q).toBe(false);
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe('creditLimit');
      const text = shortGuideAnswer(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en')!;
      expect(text, q).toMatch(/credit limit|سقف|Customers|الزبائن/i);
      expect(text, q).not.toMatch(/Live data|Who owes|USD:/i);
      expect(text, q).not.toMatch(INTERNAL_LEAK);
    }
  });

  it('users/permissions how-tos explain owner vs staff without internal keys', () => {
    for (const q of [
      'How do I manage user permissions?',
      'How do I add a staff user?',
      'كيف بضيف مستخدم؟',
      'كيف بعدل صلاحيات موظف؟',
    ]) {
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe('usersPermissions');
      const text = shortGuideAnswer(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en')!;
      expect(text, q).toMatch(/owner|المالك|Users|المستخدمين/i);
      expect(text, q).not.toMatch(INTERNAL_LEAK);
      expect(text, q).not.toMatch(/can[A-Z][A-Za-z]+/);
    }
  });

  it('reports how-tos list real tabs and date ranges without inventing rankings', () => {
    for (const q of [
      'How do I open reports?',
      'How do date ranges work in reports?',
      'What reports are available?',
      'كيف بفتح التقارير؟',
      'شو في تقارير؟',
    ]) {
      expect(classifyRead(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en', now), q).toBeNull();
      expect(matchGuide(q)?.topic, q).toBe('reports');
      const text = shortGuideAnswer(q, /[\u0600-\u06FF]/.test(q) ? 'ar' : 'en')!;
      expect(text, q).toMatch(/Sales|Profit|Inventory|Customers|Capital|Expenses|المبيعات|الأرباح|المصاريف/i);
      expect(text, q).toMatch(/date|today|yesterday|نطاق|اليوم|أمس/i);
      expect(text, q).toMatch(/not available|مش متاح/i);
      expect(text, q).not.toMatch(INTERNAL_LEAK);
    }
  });

  it('capability vs live vs unsupported stay correct', () => {
    expect(isFinancialCapabilityQuestion('Can AI move cash?')).toBe(true);
    expect(classifyRead('Can AI move cash?', 'en', now)).toBeNull();
    expect(classifyRead('How much did we sell today?', 'en', now)?.topics).toEqual(['sales']);
    expect(classifyRead('How much cash do we have?', 'en', now)?.topics).toContain('cashbox');
    expect(isFinancialExecutionRequest('Checkout now')).toBe(true);
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    // Do not fabricate loyalty/e-commerce as a reports feature
    expect(matchGuide('Do you have Shopify analytics?')?.topic).not.toBe('reports');
  });

  it('operator offers navigation for the five topics', async () => {
    const cases: Array<[string, string]> = [
      ['How do I import products?', '/products'],
      ['How do I manage product categories?', '/products'],
      ['How do customer credit limits work?', '/customers'],
      ['How do I manage user permissions?', '/users'],
      ['How do I open reports?', '/reports'],
    ];
    for (const [q, path] of cases) {
      const result = await handleOperatorTurn(q, { ...opCtx, navigate: vi.fn() }, null);
      expect(result.handled, q).toBe(true);
      expect(result.pending?.kind, q).toBe('offerNavigate');
      expect(result.pending && result.pending.kind === 'offerNavigate' && result.pending.path, q).toBe(path);
      expect(result.text, q).toMatch(/1\./);
    }
  });
});
