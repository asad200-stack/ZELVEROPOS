/**
 * Last result of each page query, kept in memory so going back to a page shows what it showed
 * before at once, while the fresh copy loads behind it. Cleared when the user or store changes.
 */
const MAX_ENTRIES = 60;
const entries = new Map<string, unknown>();

export function readQueryCache<T>(key: string): T | undefined {
  return entries.get(key) as T | undefined;
}

export function writeQueryCache(key: string, value: unknown): void {
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
}

export function clearQueryCache(): void {
  entries.clear();
}
