import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

/**
 * Throws an HttpsError whose details carry a client translation key (see src/i18n/en.ts) so the
 * UI can show a localized message.
 */
export function fail(code: FunctionsErrorCode, key: string, params?: Record<string, string | number>): never {
  throw new HttpsError(code, key, { key, params: params ?? {} });
}
