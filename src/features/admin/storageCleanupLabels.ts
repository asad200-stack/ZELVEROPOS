import type { TranslationKey } from '@/i18n/en';

export function cleanupOutcomeKey(outcome: string): TranslationKey {
  if (outcome === 'complete') return 'admin.storageCleanupComplete';
  if (outcome === 'account-remains') return 'admin.cleanupAccountRemains';
  if (outcome === 'unverified') return 'admin.cleanupUnverified';
  return 'admin.storageCleanupPending';
}
