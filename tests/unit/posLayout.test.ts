import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/pages.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../src/styles/layout.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/** Same clamp the POS uses: one line, scaled to the box, never ellipsized. */
function fittedPx(containerPx: number, chars: number, minRem = 0.62, maxRem = 1.7): number {
  const preferred = (containerPx * 1.45) / chars;
  return Math.min(maxRem * 16, Math.max(minRem * 16, preferred));
}

describe('POS layout safety', () => {
  it('keeps product cards aligned and cart controls independent of the name', () => {
    const name = rule('.product-tile__name {');
    const cartName = rule('.cart-line__name {');
    expect(name).toContain('overflow-wrap: anywhere');
    expect(name).toContain('height: max-content');
    expect(name).toContain('max-height: 2.4em');
    expect(name).not.toContain('3.2rem');
    expect(name).toContain('unicode-bidi: plaintext');
    expect(rule('.product-tile {')).toContain('grid-template-rows: subgrid');
    expect(rule('.product-tile__media {')).toContain('height: 65px');
    expect(rule('.product-tile__img {')).toContain('object-fit: contain');
    expect(rule('.picker__grid {')).toContain('minmax(min(100%, 96px), 1fr)');
    expect(cartName).toContain('overflow-wrap: anywhere');
    expect(cartName).toContain('white-space: normal');
    expect(cartName).not.toContain('line-clamp');
    expect(cartName).toContain('unicode-bidi: plaintext');
    expect(rule('.cart-line__controls {')).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    expect(rule('.cart-line__qty {')).toContain('justify-self: start');
    expect(css).not.toContain('img info qty prices actions');
    expect(css).toContain('@container pos-cart (max-width: 300px)');
    expect(rule('.product-tile__usd > .fit-slot,')).toContain('flex: 1 1 0%');
  });

  it('scales money with the container instead of clipping it', () => {
    const amount = rule('.fit-amount {');
    expect(amount).toContain('clamp(');
    expect(amount).toContain('var(--chars');
    expect(amount).toContain('nowrap');
    expect(amount).not.toContain('ellipsis');
    expect(amount).not.toContain('overflow: hidden');
    expect(rule('.fit-slot {')).toContain('container-type: inline-size');
  });

  it('uses two columns on desktop with checkout as a drawer overlay', () => {
    const pos = rule('.pos {');
    expect(pos).toContain('minmax(0, 1.7fr) minmax(280px, 38%)');
    expect(pos).toContain('position: relative');
    expect(css).toContain('.pos__pay');
    // Dedicated drawer rules (second `.pos__checkout` block after the shared panel rule).
    const checkoutDrawer = css.slice(css.lastIndexOf('\n.pos__checkout {'));
    expect(checkoutDrawer).toContain('position: absolute');
    expect(checkoutDrawer).toContain('width: min(420px, 100%)');
    expect(checkoutDrawer).toContain('inset-inline-end: 0');
    expect(css).toContain('@media (max-width: 759px)');
    expect(css).toContain('.pos--products .pos__cart');
    // PosPage applies `pos--pay` when checkout is open (class contract).
    const page = readFileSync(new URL('../../src/features/pos/PosPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain('pos--${mobileTab}');
    expect(page).toContain("checkoutOpen ? ' pos--pay' : ''");
    expect(page).toContain('className="pos__checkout"');
  });

  it('keeps the cart title and tabs on separate fixed rows', () => {
    const head = rule('.cart-head {');
    expect(head).toContain('flex: none');
    expect(head).toContain('flex-direction: column');
    const tabs = rule('.cart-tabs {');
    expect(tabs).toContain('flex-wrap: nowrap');
    expect(tabs).toContain('overflow-x: auto');
    expect(rule('.cart-tab__label {')).toContain('text-overflow: ellipsis');
    expect(rule('.fit-amount {')).not.toContain('ellipsis');
    expect(rule('.pos__lines {')).toContain('overflow-y: auto');
    expect(rule('.cart-foot {')).toContain('flex: none');
  });

  it('shows the drawer balances in the header without clipping the amounts', () => {
    const chip = layout.slice(layout.indexOf('.cash-chip__amt b {'));
    expect(chip).toContain('white-space: nowrap');
    expect(layout).toContain('.cash-chip__amt {');
    const money = layout.slice(layout.indexOf('.cash-chip__money {'), layout.indexOf('.cash-chip__amt {'));
    expect(money).toContain('direction: ltr');
    expect(money).not.toContain('ellipsis');
    expect(money).not.toContain('overflow: hidden');
  });

  it('keeps categories in one horizontal strip and the sidebar rail narrower than the menu', () => {
    const cats = rule('.picker__cats {');
    expect(cats).toContain('flex: none');
    expect(cats).not.toContain('flex-direction: column');
    expect(rule('.picker__scroller {')).toContain('overflow-x: auto');
    expect(rule('.picker__cat span {')).toContain('text-overflow: ellipsis');
    expect(rule('.picker__grid {')).toContain('overflow-y: auto');
    expect(layout).toContain('--sidebar-rail');
    expect(layout).toContain('.app--sidebar-collapsed .sidebar');
    expect(layout).toContain('.sidebar__toggle');
  });

  it('keeps USD and LBP fields in logical order', () => {
    expect(rule('.payment__pair {')).toContain('direction: ltr');
    expect(rule('.qty {')).toContain('direction: ltr');
  });

  it('fits the extreme amounts the cashier must be able to read', () => {
    const samples = [
      { label: '$9,999,999.99', chars: '$9,999,999.99'.length, box: 150 },
      { label: '895,000,000,000 LBP', chars: '895,000,000,000 LBP'.length, box: 220 },
      { label: '999,999 in stock', chars: '999,999'.length, box: 120 },
    ];
    for (const sample of samples) {
      const size = fittedPx(sample.box, sample.chars);
      const width = size * 0.62 * sample.chars;
      expect(width, sample.label).toBeLessThanOrEqual(sample.box + 1);
      expect(size).toBeGreaterThanOrEqual(9);
    }
  });
});
