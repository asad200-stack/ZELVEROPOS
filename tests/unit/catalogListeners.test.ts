import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('catalog listeners', () => {
  it('does not subscribe the POS or the tenant store to a full catalog', () => {
    const store = readFileSync(new URL('../../src/stores/tenantStore.ts', import.meta.url), 'utf8');
    const queries = readFileSync(new URL('../../src/services/catalogQuery.ts', import.meta.url), 'utf8');
    const picker = readFileSync(new URL('../../src/features/pos/ProductPicker.tsx', import.meta.url), 'utf8');
    expect(store).toContain('return Object.keys(RESOURCES)');
    expect(store).not.toContain("'products'");
    expect(store).not.toContain("'customers'");
    expect(store).not.toContain("'suppliers'");
    expect(queries).not.toContain('onSnapshot');
    expect(picker).not.toContain('onSnapshot');
    expect(picker).toContain('pageProducts');
    expect(picker).toContain('findProductByBarcode');
    const paging = readFileSync(new URL('../../src/hooks/usePagedQuery.ts', import.meta.url), 'utf8');
    expect(paging).toContain('cancelled = true');
  });
});
