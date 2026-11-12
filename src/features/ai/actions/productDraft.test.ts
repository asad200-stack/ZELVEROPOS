import { describe, expect, it } from 'vitest';
import {
  askMissingProductField,
  extractProductName,
  formatProductPreview,
  isProductFieldOnlyReply,
  missingProductFields,
  parseProductDraft,
  toProductInput,
} from './productDraft';

describe('extractProductName / parseProductDraft name parsing', () => {
  it('keeps Product inside an explicit named phrase (C2-Save regression)', () => {
    const draft = parseProductDraft('Add a product named C2 Save Test Product 20261031');
    expect(draft.name).toBe('C2 Save Test Product 20261031');
    expect(extractProductName('Add a product named C2 Save Test Product 20261031')).toBe(
      'C2 Save Test Product 20261031',
    );
  });

  it('parses quoted product names literally', () => {
    expect(parseProductDraft('Add product "Product One"').name).toBe('Product One');
    expect(parseProductDraft('Create a new product «Product One»').name).toBe('Product One');
  });

  it('parses Premium Product with a year via named', () => {
    expect(parseProductDraft('Add product named Premium Product 2026').name).toBe('Premium Product 2026');
  });

  it('parses Arabic names that contain منتج', () => {
    expect(parseProductDraft('ضيف منتج اسمه منتج تجريبي ٢٠٢٦').name).toBe('منتج تجريبي ٢٠٢٦');
    expect(parseProductDraft('أضف مادة اسمها منتج الحليب').name).toBe('منتج الحليب');
  });

  it('parses a normal name without command-like words', () => {
    expect(parseProductDraft('Add a new product called PlayStation 5, price $500').name).toBe('PlayStation 5');
  });

  it('parses names that include numbers via called/named', () => {
    expect(parseProductDraft('Create product called Widget 42').name).toBe('Widget 42');
    expect(parseProductDraft('Add a product named Cola 330ml').name).toBe('Cola 330ml');
  });

  it('accepts a whole-utterance name reply that contains Product and digits', () => {
    const draft = parseProductDraft('C2 Save Test Product 20261031', {});
    expect(draft.name).toBe('C2 Save Test Product 20261031');
  });

  it('allows correcting a prior mangled name with a full-line reply', () => {
    const draft = parseProductDraft('C2 Save Test Product 20261031', { name: '20261031', retailUsdCents: 100 });
    expect(draft.name).toBe('C2 Save Test Product 20261031');
    expect(draft.retailUsdCents).toBe(100);
  });

  it('does not invent a name from ambiguous create phrasing — asks via missing name', () => {
    const bare = parseProductDraft('Add a new product');
    expect(bare.name).toBeUndefined();
    expect(missingProductFields(bare)).toContain('name');
    expect(askMissingProductField('name', 'en')).toMatch(/product name/i);

    const namedEmpty = parseProductDraft('Add a product named');
    expect(namedEmpty.name).toBeUndefined();
    expect(missingProductFields(namedEmpty)).toContain('name');

    // Old bug path: bare "product" keyword must not capture "named …" or truncate.
    expect(extractProductName('Create a new product named C2 Save Test Product 20261031')).toBe(
      'C2 Save Test Product 20261031',
    );
    expect(extractProductName('Create a new product, price $1.00')).toBeNull();
  });

  it('does not treat command phrases as the product name', () => {
    expect(parseProductDraft('Add a new product').name).toBeUndefined();
    expect(cleanReject('a new product')).toBeNull();
  });

  it('still parses price, cost, stock, category, barcode alongside names', () => {
    const draft = parseProductDraft(
      'Add a product named C2 Save Test Product 20261031, price $1.00, cost $0.50, qty 0, category Snacks, barcode ABC-1',
    );
    expect(draft.name).toBe('C2 Save Test Product 20261031');
    expect(draft.retailUsdCents).toBe(100);
    expect(draft.costUsdCents).toBe(50);
    expect(draft.initialStock).toBe(0);
    expect(draft.category).toBe('Snacks');
    expect(draft.barcode).toBe('ABC-1');
    const input = toProductInput(draft);
    expect(input?.name).toBe('C2 Save Test Product 20261031');
    expect(input?.initialStock).toBe(0);
    expect(input?.costKnown).toBe(true);
    expect(input?.costUsdCents).toBe(50);
  });

  it('does not turn arbitrary non-create text into a name when it looks like a guide', () => {
    // looksLikeDraftFieldReply is false for guides / create requests; parse alone on a how-to
    // should not scrape a catalog name from the sentence via the old "product …" keyword.
    expect(extractProductName('How do I add a product?')).toBeNull();
    expect(parseProductDraft('How do I add a product?').name).toBeUndefined();
  });

  it('keeps with / price words inside product titles', () => {
    expect(parseProductDraft('Add product named Coffee with Milk').name).toBe('Coffee with Milk');
    expect(parseProductDraft('Add product named Smart Price Display').name).toBe('Smart Price Display');
    expect(parseProductDraft('Add product named Premium Product with Price 2026').name).toBe(
      'Premium Product with Price 2026',
    );
    // Title year must not become retailUsdCents.
    expect(parseProductDraft('Add product named Premium Product with Price 2026').retailUsdCents).toBeUndefined();
  });

  it('reads Add Preview Soap for 3 dollars without inventing stock or cost', () => {
    const draft = parseProductDraft('Add Preview Soap for 3 dollars');
    expect(draft.name).toBe('Preview Soap');
    expect(draft.retailUsdCents).toBe(300);
    expect(draft.initialStock).toBeUndefined();
    expect(draft.costUsdCents).toBeUndefined();
    const preview = formatProductPreview(draft, 'en');
    expect(preview).not.toMatch(/quantity/i);
    expect(preview).toContain('Cost: not provided');
    expect(preview).not.toContain('Cost: $0.00');
    expect(toProductInput(draft)?.costKnown).toBe(false);
    expect(toProductInput(draft)?.costUsdCents).toBe(0);
    const statedZero = { name: 'Free Sample', retailUsdCents: 100, costUsdCents: 0 };
    expect(toProductInput(statedZero)?.costKnown).toBe(true);
    expect(formatProductPreview(statedZero, 'en')).toContain('Cost: $0.00');
    const named = parseProductDraft('add a product named Preview Soap for 3 dollars');
    expect(named.name).toBe('Preview Soap');
    expect(named.retailUsdCents).toBe(300);
  });

  it('treats Stock / Price / Cost titles as names, not field-only replies', () => {
    expect(isProductFieldOnlyReply('Stock Cube')).toBe(false);
    expect(isProductFieldOnlyReply('Price List')).toBe(false);
    expect(isProductFieldOnlyReply('Cost Center')).toBe(false);
    expect(parseProductDraft('Stock Cube').name).toBe('Stock Cube');
    expect(parseProductDraft('Price List').name).toBe('Price List');
    expect(parseProductDraft('Cost Center').name).toBe('Cost Center');
    expect(parseProductDraft('Add product named Stock Cube').name).toBe('Stock Cube');
    expect(parseProductDraft('Add product named Price List').name).toBe('Price List');
    expect(parseProductDraft('Add product named Cost Center').name).toBe('Cost Center');
  });

  it('fills only the name, quantity, and three prices the user stated', () => {
    const draft = parseProductDraft(
      'Add a product named iPhone 18 Pro, price 1200, wholesale 1100, vip 1000, quantity 4',
    );
    expect(draft.name).toBe('iPhone 18 Pro');
    expect(draft.retailUsdCents).toBe(120_000);
    expect(draft.wholesaleUsdCents).toBe(110_000);
    expect(draft.vipUsdCents).toBe(100_000);
    expect(draft.initialStock).toBe(4);
    expect(draft.costUsdCents).toBeUndefined();
    expect(draft.barcode).toBeUndefined();
    expect(draft.category).toBeUndefined();
    const input = toProductInput(draft);
    expect(input?.costKnown).toBe(false);
    expect(input?.prices.retail.usdCents).toBe(120_000);
    expect(input?.prices.wholesale.usdCents).toBe(110_000);
    expect(input?.prices.vip.usdCents).toBe(100_000);
    expect(input?.initialStock).toBe(4);
  });

  it('understands name equal, price equal, and a prices list', () => {
    const spoken = parseProductDraft(
      'Add a product, name equal iPhone 18 Pro, price equal 1200, wholesale equal 1100, vip equal 1000, quantity equal 100',
    );
    expect(spoken.name).toBe('iPhone 18 Pro');
    expect(spoken.retailUsdCents).toBe(120_000);
    expect(spoken.wholesaleUsdCents).toBe(110_000);
    expect(spoken.vipUsdCents).toBe(100_000);
    expect(spoken.initialStock).toBe(100);

    const named = parseProductDraft('product named iPhone 18 Pro prices 1200 1100 1000 quantity 100');
    expect(named.name).toBe('iPhone 18 Pro');
    expect(named.retailUsdCents).toBe(120_000);
    expect(named.wholesaleUsdCents).toBe(110_000);
    expect(named.vipUsdCents).toBe(100_000);
    expect(named.initialStock).toBe(100);

    const followUp = parseProductDraft('price equal 1200', { name: 'iPhone 18 Pro', initialStock: 100 });
    expect(followUp.name).toBe('iPhone 18 Pro');
    expect(followUp.retailUsdCents).toBe(120_000);
    expect(followUp.initialStock).toBe(100);
  });

  it('keeps the name when the amount is written with the dollar sign after the number', () => {
    const draft = parseProductDraft('add a product named iphone 18 pro cost 1700$ quantity 100 prices 2000$');
    expect(draft.name).toBe('iphone 18 pro');
    expect(draft.costUsdCents).toBe(170_000);
    expect(draft.initialStock).toBe(100);
    expect(draft.retailUsdCents).toBe(200_000);
    expect(draft.wholesaleUsdCents).toBeUndefined();
    expect(draft.vipUsdCents).toBeUndefined();
  });

  it('reads the same sentence when each detail is on its own line', () => {
    const draft = parseProductDraft('add a product named iphone 18 pro\ncost 1700$\nquantity 100\nprices 2000$');
    expect(draft.name).toBe('iphone 18 pro');
    expect(draft.costUsdCents).toBe(170_000);
    expect(draft.initialStock).toBe(100);
    expect(draft.retailUsdCents).toBe(200_000);
    expect(draft.wholesaleUsdCents).toBeUndefined();
    expect(draft.vipUsdCents).toBeUndefined();
  });

  it('reads a mixed Arabic phrasing of price, quantity, and the three prices', () => {
    const draft = parseProductDraft(
      'اعمل منتج named iPhone 18 Pro السعر 1200 الكيونتيتي 4 البرايسز الثري 1200 1100 1000',
    );
    expect(draft.name).toBe('iPhone 18 Pro');
    expect(draft.retailUsdCents).toBe(120_000);
    expect(draft.wholesaleUsdCents).toBe(110_000);
    expect(draft.vipUsdCents).toBe(100_000);
    expect(draft.initialStock).toBe(4);
    expect(draft.costUsdCents).toBeUndefined();
  });

  it('reads three prices in order only from an explicit three-prices phrase', () => {
    const draft = parseProductDraft('Add product named iPhone 18 Pro, three prices 900, 800 and 700, quantity 2');
    expect(draft.name).toBe('iPhone 18 Pro');
    expect(draft.retailUsdCents).toBe(90_000);
    expect(draft.wholesaleUsdCents).toBe(80_000);
    expect(draft.vipUsdCents).toBe(70_000);
    expect(draft.initialStock).toBe(2);
  });

  it('recognizes genuine stock-only and price-only field replies', () => {
    expect(isProductFieldOnlyReply('stock 10')).toBe(true);
    expect(isProductFieldOnlyReply('stock is 10')).toBe(true);
    expect(isProductFieldOnlyReply('price $5')).toBe(true);
    expect(isProductFieldOnlyReply('price 5')).toBe(true);
    expect(isProductFieldOnlyReply('price is 5')).toBe(true);

    const stockOnly = parseProductDraft('stock 10', { name: 'Widget' });
    expect(stockOnly.name).toBe('Widget');
    expect(stockOnly.initialStock).toBe(10);

    const priceOnly = parseProductDraft('price $5', { name: 'Widget' });
    expect(priceOnly.name).toBe('Widget');
    expect(priceOnly.retailUsdCents).toBe(500);

    const priceBare = parseProductDraft('price 5', { name: 'Widget' });
    expect(priceBare.name).toBe('Widget');
    expect(priceBare.retailUsdCents).toBe(500);
  });
});

function cleanReject(raw: string) {
  // Re-use extract path: force through clean via a synthetic named phrase that would be rejected.
  return extractProductName(`named ${raw}`);
}
