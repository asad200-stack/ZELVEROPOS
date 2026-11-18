import { describe, expect, it } from 'vitest';
import {
  customPriceFromDiscount,
  customPriceFromUnit,
  matchesInvoiceQuery,
  parseQuantityPrefix,
  roomInStock,
  rowWindow,
  scrollToRow,
} from './invoiceLayout';

describe('invoice table helpers', () => {
  it('renders short invoices in full and windows long ones', () => {
    expect(rowWindow(0, 400, 40, 30)).toEqual({ start: 0, end: 30, padTop: 0, padBottom: 0 });
    const w = rowWindow(4000, 400, 40, 200, 5);
    expect(w.start).toBe(95);
    expect(w.end).toBe(115);
    expect(w.padTop).toBe(95 * 40);
    expect(w.padBottom).toBe((200 - 115) * 40);
    expect(w.padTop + (w.end - w.start) * 40 + w.padBottom).toBe(200 * 40);
  });

  it('scrolls only when the active row is outside the viewport', () => {
    expect(scrollToRow(5, 0, 400, 40)).toBeNull();
    expect(scrollToRow(20, 0, 400, 40)).toBe(21 * 40 - 400);
    expect(scrollToRow(2, 400, 400, 40)).toBe(80);
  });

  it('searches name, SKU and IMEI ignoring case and extra spaces', () => {
    expect(matchesInvoiceQuery('  pepsi ', ['Pepsi 330ml', '6291', null])).toBe(true);
    expect(matchesInvoiceQuery('6291', ['Pepsi', '62910415', null])).toBe(true);
    expect(matchesInvoiceQuery('milk', ['Pepsi', '', 'IMEI1'])).toBe(false);
    expect(matchesInvoiceQuery('', ['anything'])).toBe(true);
  });

  it('reads a quantity prefix for fast entry', () => {
    expect(parseQuantityPrefix('12*6291041500213')).toEqual({ qty: 12, query: '6291041500213' });
    expect(parseQuantityPrefix('3 x Pepsi')).toEqual({ qty: 3, query: 'Pepsi' });
    expect(parseQuantityPrefix('Pepsi 330ml')).toEqual({ qty: 1, query: 'Pepsi 330ml' });
    expect(parseQuantityPrefix('0*abc').qty).toBe(1);
  });

  it('stores discounts and typed prices as the same custom unit price the classic cart uses', () => {
    expect(customPriceFromDiscount(1000, 150)).toBe(850);
    expect(customPriceFromDiscount(1000, 0)).toBeNull();
    expect(customPriceFromDiscount(1000, 5000)).toBe(0);
    expect(customPriceFromUnit(1000, 1000)).toBeNull();
    expect(customPriceFromUnit(1000, 900)).toBe(900);
  });

  it('never lets the cart exceed stock', () => {
    expect(roomInStock(5, 3)).toBe(2);
    expect(roomInStock(5, 7)).toBe(0);
    expect(roomInStock(-2, 0)).toBe(0);
  });
});

describe('invoice cards', () => {
  it('fits four portrait cards in a typical invoice panel', async () => {
    const { cardColumns } = await import('./invoiceLayout');
    expect(cardColumns(660, 150, 12)).toBe(4);
    expect(cardColumns(320, 150, 12)).toBe(2);
    expect(cardColumns(100, 150, 12)).toBe(1);
    expect(cardColumns(0, 150, 12)).toBe(1);
  });
});
