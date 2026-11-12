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

  it('invalidates the one-shot POS catalog after an online checkout so stock is not stale', () => {
    const pos = readFileSync(new URL('../../src/features/pos/PosPage.tsx', import.meta.url), 'utf8');
    const picker = readFileSync(new URL('../../src/features/pos/ProductPicker.tsx', import.meta.url), 'utf8');
    expect(pos).toContain('catalogRevision');
    expect(pos).toContain('setCatalogRevision');
    expect(pos).toMatch(/result\.mode === 'online'[\s\S]*setCatalogRevision/);
    expect(picker).toContain('catalogRevision');
    expect(picker).toMatch(/\$\{catalogRevision\}/);
    expect(picker).toContain('keepPrevious: true');
  });

  it('gates the POS empty state on a settled catalog query so clearing search does not flash', () => {
    const picker = readFileSync(new URL('../../src/features/pos/ProductPicker.tsx', import.meta.url), 'utf8');
    expect(picker).toContain('catalogViewMode');
    expect(picker).toContain('pendingInput');
    expect(picker).toContain("view === 'empty'");
  });
});
