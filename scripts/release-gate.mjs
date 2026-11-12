/**
 * Production Hosting and the internal preview site live in the same Firebase project, so typing the
 * project id cannot tell them apart. Replacing the customer app needs this separate phrase.
 */
export const PRODUCTION_RELEASE_PHRASE = 'RELEASE TO CUSTOMERS';

export function replacesCustomerApp(only) {
  return String(only)
    .split(',')
    .map((s) => s.trim())
    .includes('hosting:production');
}

export function productionReleaseConfirmed(only, answer) {
  return !replacesCustomerApp(only) || String(answer ?? '').trim() === PRODUCTION_RELEASE_PHRASE;
}
