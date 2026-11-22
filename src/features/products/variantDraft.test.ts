import { describe, expect, it } from 'vitest';
import { comboKey } from '@/domain/variants';
import { addValues, newAxis, readDraft, selectAll, toggleValue, totalStock, withPreset, type VariantDraft } from './variantDraft';

describe('variant builder', () => {
  it('ticks values, adds typed ones and selects all', () => {
    let a = newAxis('Size', 'clothes');
    a = toggleValue(a, 'L');
    a = toggleValue(a, 'S');
    expect(a.on).toEqual(['S', 'L']);
    a = addValues(a, '4XL, 5xl');
    expect(a.on).toEqual(['S', 'L', '4XL', '5xl']);
    expect(selectAll(a, true).on).toHaveLength(a.values.length);
    const shoes = withPreset(a, 'shoes');
    expect(shoes.values).toContain('42');
    expect(shoes.values).toContain('4XL');
    expect(shoes.on).toEqual(['4XL', '5xl']);
  });

  it('turns the grid into rows with each size its own quantity', () => {
    const draft: VariantDraft = {
      axes: [{ ...newAxis('Size', 'clothes'), on: ['S', 'M'] }],
      rows: { [comboKey(['M'])]: { stock: '10', barcode: '', price: '' }, [comboKey(['S'])]: { stock: '1', barcode: 'B1', price: '12.5' } },
    };
    const out = readDraft(draft);
    expect(out).toEqual({
      ok: true,
      axes: [{ name: 'Size', values: ['S', 'M'] }],
      rows: [
        { values: ['S'], stock: 1, barcode: 'B1', retailUsdCents: 1250 },
        { values: ['M'], stock: 10, barcode: '', retailUsdCents: null },
      ],
    });
    expect(totalStock(draft)).toBe(11);
  });

  it('refuses bad input with a clear reason', () => {
    const base = { axes: [{ ...newAxis('Size', 'clothes'), on: ['S'] }], rows: {} };
    expect(readDraft({ axes: [newAxis('Size', 'clothes')], rows: {} })).toMatchObject({ ok: false, error: 'products.variants.errNone' });
    expect(readDraft({ ...base, rows: { [comboKey(['S'])]: { stock: '-1', barcode: '', price: '' } } })).toMatchObject({ ok: false, error: 'products.variants.errQty' });
    expect(readDraft({ ...base, axes: [{ ...base.axes[0]!, name: ' ' }] })).toMatchObject({ ok: false, error: 'products.variants.errName' });
  });

  it('when adding to an item, keeps only the new combinations', () => {
    const draft: VariantDraft = {
      axes: [
        { ...newAxis('Size', 'clothes'), on: ['M', 'XL'] },
        { name: 'Color', preset: 'custom', values: ['Black', 'White'], on: ['Black', 'White'] },
      ],
      rows: { [comboKey(['XL', 'Black'])]: { stock: '2', barcode: '', price: '' } },
    };
    const existing = new Set([comboKey(['M', 'Black']).toLowerCase(), comboKey(['M', 'White']).toLowerCase()]);
    const out = readDraft(draft, existing);
    expect(out.ok && out.rows.map((r) => r.values.join('/'))).toEqual(['XL/Black', 'XL/White']);
    expect(totalStock(draft, existing)).toBe(2);
    const none = { ...draft, axes: [{ ...draft.axes[0]!, on: ['M'] }, draft.axes[1]!] };
    expect(readDraft(none, existing)).toMatchObject({ ok: false, error: 'products.variants.errNothingNew' });
  });
});
