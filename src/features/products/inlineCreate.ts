import type { Supplier } from '@/types/models';

/** Option value of the "+ Add new …" entry; never stored in the product form. */
export const NEW_OPTION = '__new__';

const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The existing category with the same name (case- and spacing-insensitive), if any. */
export function findCategory(categories: string[], name: string): string | null {
  const k = key(name);
  return k ? (categories.find((c) => key(c) === k) ?? null) : null;
}

/** Same duplicate rule as createSupplier (trimmed, case-insensitive name). */
export function findSupplier<T extends { id: string; name: string }>(suppliers: T[], name: string): T | null {
  const k = name.trim().toLowerCase();
  return k ? (suppliers.find((s) => s.name.trim().toLowerCase() === k) ?? null) : null;
}

interface Option {
  value: string;
  label: string;
}

/** Keep the blank row, the current value, and "add new" visible while a typed filter narrows the list. */
export function filterSelectOptions(options: Option[], query: string, selected: string): Option[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (option) =>
      option.value === '' ||
      option.value === NEW_OPTION ||
      option.value === selected ||
      option.label.toLowerCase().includes(q),
  );
}

/** Category options; keeps a value that is not (yet) in the list visible instead of silently dropping it. */
export function categoryOptions(categories: string[], current: string, newLabel: string | null): Option[] {
  const names = [...categories].sort((a, b) => a.localeCompare(b));
  if (current && !names.includes(current)) names.unshift(current);
  return [{ value: '', label: '—' }, ...names.map((c) => ({ value: c, label: c })), ...(newLabel ? [{ value: NEW_OPTION, label: newLabel }] : [])];
}

/** Supplier options, including one just created whose listener update has not arrived yet. */
export function supplierOptions(suppliers: Pick<Supplier, 'id' | 'name'>[], newLabel: string | null): Option[] {
  const sorted = [...suppliers].sort((a, b) => a.name.localeCompare(b.name));
  return [{ value: '', label: '—' }, ...sorted.map((s) => ({ value: s.id, label: s.name })), ...(newLabel ? [{ value: NEW_OPTION, label: newLabel }] : [])];
}

export function mergeSuppliers<T extends Pick<Supplier, 'id' | 'name'>>(live: T[], pending: T[]): T[] {
  return [...live, ...pending.filter((p) => !live.some((s) => s.id === p.id))];
}

export type InlineOutcome<T> = { kind: 'created'; value: T } | { kind: 'existing'; value: T } | { kind: 'invalid' };

/** Category: reuse an existing one, otherwise create it through the normal categories service. */
export async function resolveCategory(name: string, categories: string[], add: (name: string) => Promise<void>): Promise<InlineOutcome<string>> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { kind: 'invalid' };
  const existing = findCategory(categories, clean);
  if (existing) return { kind: 'existing', value: existing };
  await add(clean);
  return { kind: 'created', value: clean };
}

/** Supplier: reuse an existing one, otherwise create it through the normal suppliers service. */
export async function resolveSupplier(
  input: { name: string; phone: string },
  suppliers: Pick<Supplier, 'id' | 'name'>[],
  create: (input: { name: string; phone: string }) => Promise<string>,
): Promise<InlineOutcome<{ id: string; name: string }>> {
  const name = input.name.trim();
  if (!name) return { kind: 'invalid' };
  const existing = findSupplier(suppliers, name);
  if (existing) return { kind: 'existing', value: { id: existing.id, name: existing.name } };
  const id = await create({ name, phone: input.phone.trim() });
  return { kind: 'created', value: { id, name } };
}

/** Wraps an async action so overlapping calls (double clicks, Enter + click) share one run. */
export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let running: Promise<R> | null = null;
  return (...args: A) => {
    if (!running) running = fn(...args).finally(() => (running = null));
    return running;
  };
}
