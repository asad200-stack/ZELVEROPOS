import { describe, expect, it } from 'vitest';
import { product } from './fixtures.test-utils';
import {
  findByBarcode,
  packPurchase,
  packUnitIssues,
  packsAvailable,
  setIssues,
  setsAvailable,
  stockDemand,
  unitCostUsdCents,
  type PackUnit,
  type StockUnitFields,
} from './stockUnits';

const prices = { retail: { usdCents: 4500, lbp: null }, wholesale: { usdCents: 4000, lbp: null }, vip: { usdCents: 4200, lbp: null } };
const carton: PackUnit = { name: 'Carton', size: 10, barcode: 'CARTON-1', prices };

function catalog(...items: StockUnitFields[]): Map<string, StockUnitFields> {
  return new Map(items.map((p) => [p.id, p]));
}

const coal = product({ id: 'coal', name: 'Coal box', barcode: 'COAL-1', stock: 35, costUsdCents: 300, packUnit: carton } as Partial<StockUnitFields>) as StockUnitFields;
const base = product({ id: 'base', name: 'Base', stock: 4, costUsdCents: 1000 });
const hose = product({ id: 'hose', name: 'Hose', stock: 9, costUsdCents: 200 });
const head = product({ id: 'head', name: 'Head', stock: 12, costUsdCents: 150 });
const hookah = product({
  id: 'set',
  name: 'Full hookah',
  stock: 0,
  costUsdCents: 0,
  setComponents: [
    { productId: 'base', quantity: 1 },
    { productId: 'hose', quantity: 1 },
    { productId: 'head', quantity: 2 },
  ],
} as Partial<StockUnitFields>) as StockUnitFields;

describe('stock units: packs', () => {
  it('turns a pack line into base pieces', () => {
    const r = stockDemand([{ productId: 'coal', quantity: 2, pack: true }, { productId: 'coal', quantity: 3 }], catalog(coal));
    expect(r.ok && r.demand.get('coal')).toBe(23);
  });

  it('refuses a pack line on a product without a pack unit', () => {
    const r = stockDemand([{ productId: 'base', quantity: 1, pack: true }], catalog(base));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('noPackUnit');
  });

  it('counts whole packs only', () => {
    expect(packsAvailable(coal)).toBe(3);
    expect(packsAvailable(base)).toBe(0);
  });

  it('finds the piece first, then the pack barcode', () => {
    expect(findByBarcode('COAL-1', [coal])?.pack).toBe(false);
    expect(findByBarcode(' CARTON-1 ', [coal])?.pack).toBe(true);
    expect(findByBarcode('nope', [coal])).toBeNull();
    expect(findByBarcode('CARTON-1', [{ ...coal, status: 'archived' }])).toBeNull();
  });

  it('validates the pack definition', () => {
    expect(packUnitIssues(carton, 'COAL-1')).toEqual([]);
    expect(packUnitIssues({ ...carton, size: 1 }, 'COAL-1')).toContain('size');
    expect(packUnitIssues({ ...carton, size: 2.5 }, 'COAL-1')).toContain('size');
    expect(packUnitIssues({ ...carton, barcode: 'COAL-1' }, 'COAL-1')).toContain('barcodeSameAsPiece');
    expect(packUnitIssues({ ...carton, name: ' ' }, '')).toContain('name');
  });

  it('converts pack purchases to pieces and piece cost', () => {
    expect(packPurchase(3, 2500, 10)).toEqual({ pieces: 30, unitCostUsdCents: 250 });
    expect(packPurchase(1, 1000, 3)).toEqual({ pieces: 3, unitCostUsdCents: 333 });
  });

  it('costs a pack as size × piece cost', () => {
    expect(unitCostUsdCents(coal, catalog(coal), true)).toBe(3000);
  });
});

describe('stock units: sets', () => {
  const all = catalog(base, hose, head, hookah);

  it('deducts every component and nothing from the set itself', () => {
    const r = stockDemand([{ productId: 'set', quantity: 2 }, { productId: 'head', quantity: 1 }], all);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demand.get('base')).toBe(2);
    expect(r.demand.get('hose')).toBe(2);
    expect(r.demand.get('head')).toBe(5);
    expect(r.demand.has('set')).toBe(false);
  });

  it('limits sets by the scarcest component', () => {
    expect(setsAvailable(hookah, all)).toBe(4);
    expect(setsAvailable(hookah, catalog(base, hose, { ...head, stock: 3 }, hookah))).toBe(1);
    expect(setsAvailable(hookah, catalog(base, hose, hookah))).toBe(0);
  });

  it('costs a set as the sum of its parts', () => {
    expect(unitCostUsdCents(hookah, all)).toBe(1000 + 200 + 300);
  });

  it('rejects nested sets, self, duplicates, unknown and bad quantities', () => {
    const issues = setIssues(
      'set2',
      [
        { productId: 'set', quantity: 1 },
        { productId: 'set2', quantity: 1 },
        { productId: 'base', quantity: 1 },
        { productId: 'base', quantity: 0 },
        { productId: 'ghost', quantity: 1 },
      ],
      all,
    );
    expect(issues).toEqual(expect.arrayContaining(['nested', 'self', 'duplicate', 'quantity', 'unknown']));
    expect(setIssues('set', [], all)).toEqual(['empty']);
    expect(setIssues('set', hookah.setComponents ?? [], all)).toEqual([]);
  });

  it('refuses to sell a set with an archived or nested component', () => {
    const archived = stockDemand([{ productId: 'set', quantity: 1 }], catalog({ ...base, status: 'archived' }, hose, head, hookah));
    expect(!archived.ok && archived.error.code).toBe('archivedComponent');
    const inner = { ...hookah, id: 'outer', setComponents: [{ productId: 'set', quantity: 1 }] };
    const nested = stockDemand([{ productId: 'outer', quantity: 1 }], catalog(base, hose, head, hookah, inner));
    expect(!nested.ok && nested.error.code).toBe('nestedSet');
  });

  it('leaves ordinary products unchanged', () => {
    const r = stockDemand([{ productId: 'base', quantity: 3 }], all);
    expect(r.ok && r.demand.get('base')).toBe(3);
  });
});
