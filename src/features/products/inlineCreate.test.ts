import { describe, expect, it, vi } from 'vitest';
import type { Supplier } from '@/types/models';
import {
  NEW_OPTION,
  categoryOptions,
  findCategory,
  findSupplier,
  mergeSuppliers,
  resolveCategory,
  resolveSupplier,
  singleFlight,
  supplierOptions,
} from './inlineCreate';

const sup = (id: string, name: string) => ({ id, name }) as Supplier;

describe('category inline creation', () => {
  it('matches existing categories case- and spacing-insensitively', () => {
    expect(findCategory(['Phones', 'Cables'], '  phones ')).toBe('Phones');
    expect(findCategory(['Phone Cases'], 'phone   cases')).toBe('Phone Cases');
    expect(findCategory(['Phones'], 'Chargers')).toBeNull();
    expect(findCategory(['Phones'], '   ')).toBeNull();
  });

  it('creates a new category through the provided service', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    await expect(resolveCategory('  Chargers ', ['Phones'], add)).resolves.toEqual({ kind: 'created', value: 'Chargers' });
    expect(add).toHaveBeenCalledWith('Chargers');
  });

  it('selects the existing category instead of creating a duplicate', async () => {
    const add = vi.fn();
    await expect(resolveCategory('PHONES', ['Phones'], add)).resolves.toEqual({ kind: 'existing', value: 'Phones' });
    expect(add).not.toHaveBeenCalled();
  });

  it('does nothing for an empty name', async () => {
    const add = vi.fn();
    await expect(resolveCategory('  ', [], add)).resolves.toEqual({ kind: 'invalid' });
    expect(add).not.toHaveBeenCalled();
  });

  it('propagates permission errors without swallowing them', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    await expect(resolveCategory('New', [], () => Promise.reject(denied))).rejects.toBe(denied);
  });

  it('lists categories sorted, keeps an unlisted current value, and ends with the add option', () => {
    const opts = categoryOptions(['b', 'a'], 'legacy', '+ Add');
    expect(opts.map((o) => o.value)).toEqual(['', 'legacy', 'a', 'b', NEW_OPTION]);
    expect(categoryOptions(['a'], 'a', null).map((o) => o.value)).toEqual(['', 'a']);
  });
});

describe('supplier inline creation', () => {
  const suppliers = [sup('s1', 'Acme Trading'), sup('s2', 'Beta')];

  it('uses the same duplicate rule as createSupplier (trimmed, case-insensitive)', () => {
    expect(findSupplier(suppliers, ' acme trading ')?.id).toBe('s1');
    expect(findSupplier(suppliers, 'Gamma')).toBeNull();
  });

  it('creates a new supplier and returns its id and name', async () => {
    const create = vi.fn().mockResolvedValue('s3');
    await expect(resolveSupplier({ name: ' Gamma ', phone: ' 71123456 ' }, suppliers, create)).resolves.toEqual({
      kind: 'created',
      value: { id: 's3', name: 'Gamma' },
    });
    expect(create).toHaveBeenCalledWith({ name: 'Gamma', phone: '71123456' });
  });

  it('selects the existing supplier instead of creating a duplicate', async () => {
    const create = vi.fn();
    await expect(resolveSupplier({ name: 'BETA', phone: '' }, suppliers, create)).resolves.toEqual({
      kind: 'existing',
      value: { id: 's2', name: 'Beta' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates permission errors', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    await expect(resolveSupplier({ name: 'New', phone: '' }, [], () => Promise.reject(denied))).rejects.toBe(denied);
  });

  it('offers the add option only when allowed, and shows a just-created supplier before the listener catches up', () => {
    const merged = mergeSuppliers(suppliers, [sup('s3', 'Gamma'), sup('s1', 'Acme Trading')]);
    expect(merged.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(supplierOptions(merged, '+ Add').map((o) => o.value)).toEqual(['', 's1', 's2', 's3', NEW_OPTION]);
    expect(supplierOptions(merged, null).some((o) => o.value === NEW_OPTION)).toBe(false);
  });
});

describe('singleFlight', () => {
  it('runs an action once for overlapping calls, then allows a new run', async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (release = r)));
    const guarded = singleFlight(fn);
    const a = guarded();
    const b = guarded();
    const c = guarded();
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b, c]);
    const d = guarded();
    expect(fn).toHaveBeenCalledTimes(2);
    release();
    await d;
  });

  it('releases the guard after a failure', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok');
    const guarded = singleFlight(fn);
    await expect(guarded()).rejects.toThrow('x');
    await expect(guarded()).resolves.toBe('ok');
  });
});
