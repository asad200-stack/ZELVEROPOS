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
  it('keeps product names and cart names fully visible', () => {
    const name = rule('.product-tile__name {');
    const cartName = rule('.cart-line__name {');
    expect(name).toContain('overflow-wrap: anywhere');
    expect(name).not.toContain('line-clamp');
    expect(name).not.toContain('ellipsis');
    expect(cartName).toContain('overflow-wrap: anywhere');
    expect(cartName).not.toContain('ellipsis');
    expect(cartName).not.toContain('nowrap');
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

  it('uses three columns on desktop and tabs below that', () => {
    const pos = rule('.pos {');
    expect(pos).toContain('minmax(0, 1fr) minmax(280px, 340px) minmax(250px, 300px)');
    expect(css).toContain('.pos--checkout .pos__products');
    expect(css).toContain('max-width: 1100px');
  });

  it('keeps the cart title and tabs on separate fixed rows', () => {
    expect(rule('.cart-head {')).toContain('flex: none');
    expect(rule('.cart-head {')).toContain('justify-content: space-between');
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
