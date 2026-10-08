import { describe, expect, it } from 'vitest';
import { isValidExchangeRate, suggestedLbpInput, usdCentsToLbp } from '@/domain/money';
import {
  addSerial,
  draftFromStored,
  editOmitsOpeningInventory,
  enterAction,
  lbpEdited,
  lbpToSave,
  nextProductField,
  productFieldOrder,
  rateChanged,
  replaceSerial,
  resolveCreateInventory,
  selectEnterMoves,
  usdEdited,
} from './productFormLogic';

const RATE = 89_500;

describe('USD to LBP', () => {
  it('uses the store rate for each tier', () => {
    expect(usdCentsToLbp(100, RATE)).toBe(89_500);
    expect(usdCentsToLbp(80, RATE)).toBe(71_600);
    expect(usdCentsToLbp(70, RATE)).toBe(62_650);
    expect(suggestedLbpInput('1.00', RATE)).toBe('89,500');
    expect(suggestedLbpInput('0.80', RATE)).toBe('71,600');
    expect(suggestedLbpInput('0.70', RATE)).toBe('62,650');
  });

  it('does not invent a price for an empty, zero, or invalid USD, or a bad rate', () => {
    expect(suggestedLbpInput('', RATE)).toBe('');
    expect(suggestedLbpInput('0', RATE)).toBe('0');
    expect(suggestedLbpInput('12.5.1', RATE)).toBeNull();
    expect(isValidExchangeRate(0)).toBe(false);
    expect(isValidExchangeRate(Number.NaN)).toBe(false);
    expect(suggestedLbpInput('1.00', 0)).toBeNull();
    expect(suggestedLbpInput('1.00', 1.5)).toBeNull();
  });

  it('recalculates while automatic, keeps a manual override, and restores auto when cleared', () => {
    const auto = draftFromStored(0, null, RATE, true);
    const priced = usdEdited(auto, '1.00', RATE);
    expect(priced).toMatchObject({ lbpMode: 'auto', lbp: '89,500' });
    const manual = lbpEdited(priced, '90,000', RATE);
    expect(manual.lbpMode).toBe('manual');
    expect(usdEdited(manual, '2.00', RATE).lbp).toBe('90,000');
    expect(rateChanged(manual, 90_000).lbp).toBe('90,000');
    expect(lbpToSave(manual)).toBe(90_000);
    const cleared = lbpEdited(manual, '   ', RATE);
    expect(cleared).toMatchObject({ lbpMode: 'auto', lbp: '89,500' });
    expect(lbpToSave(cleared)).toBeNull();
  });

  it('updates an open form when the rate changes, and clears automatic LBP when the rate is invalid', () => {
    const draft = usdEdited(draftFromStored(100, null, RATE, false), '1.00', RATE);
    expect(rateChanged(draft, 90_000).lbp).toBe('90,000');
    expect(rateChanged(draft, 0)).toMatchObject({ lbp: '', lbpMode: 'auto' });
    const manual = lbpEdited(draft, '90,000', RATE);
    expect(rateChanged(manual, 0).lbp).toBe('90,000');
  });

  it('treats a stored LBP that differs from the current rate as a manual override', () => {
    expect(draftFromStored(100, 90_000, RATE, false)).toMatchObject({ lbpMode: 'manual', lbp: '90000' });
    expect(draftFromStored(100, null, RATE, false)).toMatchObject({ lbpMode: 'auto', lbp: '89,500' });
  });
});

describe('Enter navigation', () => {
  const addOrder = productFieldOrder({ showCost: true, showInitialStock: true, showImeiEntry: true });
  const plainOrder = productFieldOrder({ showCost: true, showInitialStock: true, showImeiEntry: false });
  const editOrder = productFieldOrder({ showCost: false, showInitialStock: false, showImeiEntry: false });

  it('walks the visible fields and never submits from Enter', () => {
    expect(addOrder).toEqual([
      'name',
      'category',
      'barcode',
      'supplierId',
      'retail',
      'wholesale',
      'vip',
      'retailLbp',
      'wholesaleLbp',
      'vipLbp',
      'cost',
      'minStock',
      'expiryDate',
      'initialStock',
      'imeiTracking',
      'imeiEntry',
      'product-image',
    ]);
    expect(nextProductField('name', addOrder)).toBe('category');
    expect(nextProductField('retail', addOrder)).toBe('wholesale');
    expect(nextProductField('vipLbp', addOrder)).toBe('cost');
    expect(nextProductField('expiryDate', plainOrder)).toBe('initialStock');
    expect(nextProductField('expiryDate', editOrder)).toBe('imeiTracking');
    expect(enterAction({ tag: 'INPUT', name: 'name', inInline: false }, addOrder)).toEqual({ type: 'focus', name: 'category' });
    expect(enterAction({ tag: 'INPUT', name: 'product-image', type: 'file', inInline: false }, addOrder)).toEqual({ type: 'stay' });
    expect(enterAction({ tag: 'INPUT', name: 'imeiEntry', inInline: false }, addOrder)).toEqual({ type: 'add-serial' });
    expect(enterAction({ tag: 'SELECT', name: 'category', inInline: false }, addOrder)).toEqual({ type: 'ignore' });
    expect(enterAction({ tag: 'INPUT', name: 'categoryName', inInline: true }, addOrder)).toEqual({ type: 'ignore' });
    expect(enterAction({ tag: 'BUTTON', name: '', inInline: false }, addOrder)).toEqual({ type: 'ignore' });
  });

  it('lets a select choose the highlighted option, including inline create, without moving on', () => {
    expect(selectEnterMoves('phones', false)).toBe(true);
    expect(selectEnterMoves('__new__', false)).toBe(false);
    expect(selectEnterMoves('phones', true)).toBe(false);
  });
});

describe('IMEI entry', () => {
  it('adds scanner input one at a time and rejects duplicates and blanks', () => {
    const first = addSerial([], '  352099001234567  ');
    expect(first).toMatchObject({ error: null, list: ['352099001234567'] });
    const second = addSerial(first.list, '352099001234575');
    expect(second.list).toEqual(['352099001234567', '352099001234575']);
    expect(addSerial(second.list, '352099001234567').error).toBe('duplicate');
    expect(addSerial(second.list, '   ').error).toBe('empty');
    expect(addSerial(second.list, 'x'.repeat(65)).error).toBe('long');
    expect(replaceSerial(second.list, 1, '352099001234567').error).toBe('duplicate');
    expect(replaceSerial(second.list, 0, '').list).toEqual(['352099001234575']);
  });

  it('rejects an initial stock count that does not match the serials, and accepts a matching or blank count', () => {
    expect(resolveCreateInventory(true, 5, ['a', 'b', 'c'])).toEqual({ ok: false, stock: 5, count: 3 });
    expect(resolveCreateInventory(true, null, ['a', 'b', 'c'])).toEqual({ ok: true, initialStock: 3, initialImeis: ['a', 'b', 'c'] });
    expect(resolveCreateInventory(true, 2, [' a ', 'b'])).toEqual({ ok: true, initialStock: 2, initialImeis: ['a', 'b'] });
    expect(resolveCreateInventory(false, 5, ['a'])).toEqual({ ok: true, initialStock: 5, initialImeis: [] });
  });

  it('does not send opening stock or serials on edit', () => {
    expect(editOmitsOpeningInventory({ name: 'Phone', imeiTracking: true })).toBe(true);
    expect(editOmitsOpeningInventory({ name: 'Phone', initialStock: 5, initialImeis: ['a'] })).toBe(false);
  });
});
