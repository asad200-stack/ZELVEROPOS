import { describe, expect, it } from 'vitest';
import { PRODUCTION_RELEASE_PHRASE, productionReleaseConfirmed, replacesCustomerApp } from '../../scripts/release-gate.mjs';

const ALL = 'hosting:production,firestore:rules,firestore:indexes,storage,functions';

describe('production release gate', () => {
  it('only deploys that include production Hosting replace the customer app', () => {
    expect(replacesCustomerApp(ALL)).toBe(true);
    expect(replacesCustomerApp('hosting:production')).toBe(true);
    expect(replacesCustomerApp('hosting:staging')).toBe(false);
    expect(replacesCustomerApp('functions')).toBe(false);
    expect(replacesCustomerApp('firestore:rules,firestore:indexes,storage')).toBe(false);
  });

  it('the project id alone never releases to customers', () => {
    expect(productionReleaseConfirmed(ALL, 'zelvoropos')).toBe(false);
    expect(productionReleaseConfirmed('hosting:production', '')).toBe(false);
    expect(productionReleaseConfirmed('hosting:production', PRODUCTION_RELEASE_PHRASE)).toBe(true);
    expect(productionReleaseConfirmed('hosting:staging', '')).toBe(true);
  });
});
