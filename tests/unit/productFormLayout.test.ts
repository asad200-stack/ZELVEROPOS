import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product form layout', () => {
  const css = readFileSync(new URL('../../src/styles/components.css', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../../src/features/products/ProductFormModal.tsx', import.meta.url), 'utf8');

  it('gives the image its own file control and keeps Initial Stock ahead of it', () => {
    expect(css).toMatch(/\.input--file\s*\{[^}]*height:\s*auto/);
    expect(css).toMatch(/\.form-grid > \* \{[^}]*min-width:\s*0/);
    expect(modal).toContain('className="input input--file"');
    expect(modal).toContain('product-form__image');
    const stock = modal.indexOf("t('products.initialStock')");
    const image = modal.indexOf('product-form__image');
    expect(stock).toBeGreaterThan(-1);
    expect(image).toBeGreaterThan(stock);
    expect(modal).not.toContain('type="submit"');
  });
});
