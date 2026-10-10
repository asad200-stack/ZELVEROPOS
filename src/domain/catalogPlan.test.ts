import { describe, expect, it } from 'vitest';
import { emptyProductQuery, looksLikeCode, planBarcode, planParty, planProducts, CATALOG_PAGE_SIZE } from './catalogPlan';
import { nameNormalized } from './searchKey';

const fields = (plan: ReturnType<typeof planProducts>) => plan.filter((step) => step.op === 'where' || step.op === 'orderBy');

describe('catalog query plans', () => {
  it('pages the active catalog by normalized name and never uses an offset', () => {
    const plan = planProducts(emptyProductQuery(), false);
    expect(plan.some((step) => step.op === 'startAfter')).toBe(false);
    expect(plan.at(-1)).toEqual({ op: 'limit', n: CATALOG_PAGE_SIZE });
    expect(CATALOG_PAGE_SIZE).toBeGreaterThanOrEqual(40);
    expect(CATALOG_PAGE_SIZE).toBeLessThanOrEqual(50);
    expect(fields(plan)).toEqual([
      { op: 'where', field: 'status', cmp: '==', value: 'active' },
      { op: 'orderBy', field: 'nameNormalized', dir: 'asc' },
      { op: 'orderBy', field: '__name__', dir: 'asc' },
    ]);
  });

  it('keeps a category page inside that category', () => {
    const plan = planProducts(emptyProductQuery({ category: 'electronics' }), true);
    expect(fields(plan)).toContainEqual({ op: 'where', field: 'category', cmp: '==', value: 'electronics' });
    expect(plan.some((step) => step.op === 'startAfter')).toBe(true);
    expect(fields(plan).some((step) => step.op === 'where' && step.field === 'category' && step.value !== 'electronics')).toBe(false);
  });

  it('searches a normalized name prefix instead of the whole collection', () => {
    const plan = planProducts(emptyProductQuery({ search: '  Phone   Case ' }), false);
    const prefix = nameNormalized('  Phone   Case ');
    expect(prefix).toBe('phone case');
    expect(fields(plan)).toContainEqual({ op: 'where', field: 'nameNormalized', cmp: '>=', value: prefix });
    expect(fields(plan)).toContainEqual({ op: 'where', field: 'nameNormalized', cmp: '<=', value: `${prefix}\uf8ff` });
    expect(plan.filter((step) => step.op === 'limit')).toEqual([{ op: 'limit', n: CATALOG_PAGE_SIZE }]);
  });

  it('looks up a barcode by equality and returns at most one document', () => {
    expect(planBarcode('  ABC-1234 ', true)).toEqual([
      { op: 'where', field: 'barcode', cmp: '==', value: 'ABC-1234' },
      { op: 'where', field: 'status', cmp: '==', value: 'active' },
      { op: 'limit', n: 1 },
    ]);
  });

  it('treats a compact code as a barcode candidate', () => {
    expect(looksLikeCode('ABC-1234')).toBe(true);
    expect(looksLikeCode('ab')).toBe(false);
    expect(looksLikeCode('phone case')).toBe(false);
  });

  it('bounds customer and supplier search the same way', () => {
    const customers = planParty('customers', { search: 'ali' }, false);
    const suppliers = planParty('suppliers', { search: '' }, false);
    expect(Array.isArray(customers) && customers.some((step) => step.op === 'limit' && step.n === CATALOG_PAGE_SIZE)).toBe(true);
    expect(Array.isArray(suppliers) && suppliers.at(-1)).toEqual({ op: 'limit', n: CATALOG_PAGE_SIZE });
    expect(planParty('customers', { search: '9613123456' }, false)).toEqual({ exact: 'phone', value: '9613123456' });
    expect(planParty('suppliers', { search: 'a@b.co' }, false)).toEqual({ exact: 'email', value: 'a@b.co' });
  });
});
