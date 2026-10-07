import type { TParams, TranslationKey } from '@/i18n/i18n';
import { isTranslationKey } from '@/i18n/i18n';

/** Error with a translatable, user-facing message. Services throw these for business failures. */
export class AppError extends Error {
  readonly key: TranslationKey;
  readonly params?: TParams;
  constructor(key: TranslationKey, params?: TParams) {
    super(key);
    this.name = 'AppError';
    this.key = key;
    this.params = params;
  }
}

const FIREBASE_CODE_MAP: Record<string, TranslationKey> = {
  'auth/invalid-credential': 'error.auth.invalidCredential',
  'auth/wrong-password': 'error.auth.invalidCredential',
  'auth/user-not-found': 'error.auth.invalidCredential',
  'auth/invalid-email': 'error.auth.invalidEmail',
  'auth/email-already-in-use': 'error.auth.signupFailed',
  'auth/weak-password': 'error.auth.weakPassword',
  'auth/too-many-requests': 'error.auth.tooManyRequests',
  'auth/user-disabled': 'error.auth.userDisabled',
  'auth/network-request-failed': 'error.network',
  'auth/requires-recent-login': 'error.auth.recentLogin',
  'permission-denied': 'error.permissionDenied',
  'functions/permission-denied': 'error.permissionDenied',
  unauthenticated: 'error.unauthenticated',
  'functions/unauthenticated': 'error.unauthenticated',
  unavailable: 'error.network',
  'functions/unavailable': 'error.network',
  'deadline-exceeded': 'error.network',
  'functions/deadline-exceeded': 'error.network',
  'not-found': 'error.notFound',
  'functions/not-found': 'error.notFound',
  'already-exists': 'error.alreadyExists',
  'functions/already-exists': 'error.alreadyExists',
  'resource-exhausted': 'error.tooManyRequests',
  'functions/resource-exhausted': 'error.tooManyRequests',
  'failed-precondition': 'error.failedPrecondition',
  aborted: 'error.conflict',
  'storage/unauthorized': 'error.permissionDenied',
  'storage/quota-exceeded': 'error.storageQuota',
};

export interface UserMessage {
  key: TranslationKey;
  params?: TParams;
  detail?: string;
}

/** Converts any thrown value into a translatable message (never leaks raw stack traces). */
export function toUserMessage(error: unknown): UserMessage {
  if (error instanceof AppError) return { key: error.key, params: error.params };
  const e = error as { code?: string; message?: string; details?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  // Callable functions return `details.key` for business errors.
  const details = e?.details as { key?: string; params?: TParams } | undefined;
  if (details?.key && isTranslationKey(details.key)) return { key: details.key, params: details.params };
  if (code && FIREBASE_CODE_MAP[code]) return { key: FIREBASE_CODE_MAP[code], detail: e?.message };
  if (code === 'functions/invalid-argument' || code === 'invalid-argument') {
    return { key: 'error.invalidInput', detail: e?.message };
  }
  return { key: 'error.unexpected', detail: e?.message };
}

export function isNetworkError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return ['unavailable', 'deadline-exceeded', 'auth/network-request-failed', 'functions/unavailable'].includes(code);
}

export function logError(context: string, error: unknown): void {
  if (error instanceof AppError) return;
  console.error(`[${context}]`, error);
}
