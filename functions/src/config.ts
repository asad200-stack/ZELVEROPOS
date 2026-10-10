import { defineInt, defineString } from 'firebase-functions/params';

/** Must stay compatible with the Firestore location (eur3) for the Firestore triggers. */
export const REGION = 'europe-west1';

/** Dedicated least-privilege runtime identity; "name@" is expanded to name@<project>.iam.gserviceaccount.com. */
export const RUNTIME_SERVICE_ACCOUNT = 'zelvero-functions-runtime@';

/** Comma-separated e-mails allowed to become platform super admins (via bootstrapSuperAdmin). */
export const SUPER_ADMIN_EMAILS = defineString('SUPER_ADMIN_EMAILS', {
  default: '',
  description: 'Comma-separated e-mail addresses allowed to claim the platform super admin role',
});

/** Free trial granted to new stores; 0 = the super admin must activate every new store. */
export const SIGNUP_TRIAL_DAYS = defineInt('SIGNUP_TRIAL_DAYS', {
  default: 0,
  description: 'Number of free trial days for new stores (0 = manual activation)',
});

/** Time zone used for dates in Telegram notifications. */
export const TELEGRAM_TIMEZONE = defineString('TELEGRAM_TIMEZONE', {
  default: 'Asia/Beirut',
  description: 'IANA time zone for dates in Telegram notifications',
});

/** Time zone of the store's business day (dailyStats and the `localDate` of every document). */
export const BUSINESS_TIMEZONE = defineString('BUSINESS_TIMEZONE', {
  default: 'Asia/Beirut',
  description: 'IANA time zone used to compute business dates',
});

export const DAY_MS = 86_400_000;
/** Claim value used for lifetime subscriptions (2100-01-01). */
export const LIFETIME_UNTIL = 4_102_444_800_000;

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Tenant collections holding business data (cleared by clearTenantData / deleted with the account). */
export const BUSINESS_COLLECTIONS = [
  'products',
  'customers',
  'customerLedger',
  'suppliers',
  'purchases',
  'purchaseReturns',
  'supplierPayments',
  'sales',
  'returns',
  'stockMovements',
  'cashTransactions',
  'dailyStats',
  'clientOps',
] as const;
