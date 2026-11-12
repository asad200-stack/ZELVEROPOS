export const TRIAL_FIELDS = ['business', 'owner', 'email', 'phone', 'type', 'country', 'currency', 'password'] as const;

export function validateTrial(data: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!data.business?.trim()) errors.push('business');
  if (!data.owner?.trim()) errors.push('owner');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '')) errors.push('email');
  if (!data.phone?.trim()) errors.push('phone');
  if (!data.type?.trim()) errors.push('type');
  if (!data.country?.trim()) errors.push('country');
  if (!data.currency?.trim()) errors.push('currency');
  if (!data.password || data.password.length < 8) errors.push('password');
  return errors;
}

export const TRIAL_BENEFITS = ['Full access during trial', 'Your business data stays private', 'Cancel anytime before subscribing'] as const;

/** Public trial stays gated server-side until owner approval. Staging accepts @zelvero.test. */
export const TRIAL_PROVISIONING_ACTIVE = true;
