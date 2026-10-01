/**
 * The callable SDK encodes `undefined` as `null`, which the server schemas reject for optional
 * fields, so absent values are dropped before sending.
 */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => withoutUndefined(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, withoutUndefined(v)]),
    ) as T;
  }
  return value;
}

/** What the callable SDK actually puts on the wire (`undefined` becomes `null`). */
export function sdkEncode(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (v === undefined ? null : v)));
}
