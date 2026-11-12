import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

export { HttpsError };

/**
 * Throws an HttpsError whose details carry a client translation key (see src/i18n/en.ts) so the
 * UI can show a localized message.
 */
export function fail(code: FunctionsErrorCode, key: string, params?: Record<string, string | number>): never {
  throw new HttpsError(code, key, { key, params: params ?? {} });
}

/**
 * Validation and business errors already carry a client key. Anything else becomes a generic
 * internal error so the callable response does not include the original message or stack.
 * The original error is logged for operators only.
 */
export function rethrowClientSafe(err: unknown): never {
  if (err instanceof HttpsError) throw err;
  console.error('Callable failed', err);
  fail('internal', 'error.unexpected');
}
