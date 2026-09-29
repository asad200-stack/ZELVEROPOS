import { httpsCallable } from 'firebase/functions';
import { firebase } from '@/firebase/app';
import type { PermissionMap } from '@/constants/permissions';

/** Typed wrappers for the callable Cloud Functions (see functions/src). */
function callable<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> => {
    const fn = httpsCallable<Req, Res>(firebase.functions, name, { timeout: 60_000 });
    const result = await fn(data);
    return result.data;
  };
}

export interface SignupInput {
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
}

export interface AdminAccount {
  uid: string;
  email: string;
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
  createdAt: number | null;
  lastSignInAt: number | null;
  subUserCount: number;
  subscription: { activated: boolean; lifetime: boolean; startsAt: number | null; endsAt: number | null };
}

export type SubscriptionAction =
  | { action: 'activate'; days: number }
  | { action: 'extend'; days: number }
  | { action: 'lifetime' }
  | { action: 'deactivate' };

export const api = {
  checkSignupAvailability: callable<{ subdomain: string; email: string }, { subdomainAvailable: boolean; emailAvailable: boolean }>(
    'checkSignupAvailability',
  ),
  completeSignup: callable<SignupInput, { tenantId: string }>('completeSignup'),
  refreshMyClaims: callable<Record<string, never>, { ok: true }>('refreshMyClaims'),
  createSubUser: callable<{ email: string; password: string; fullName: string; permissions: PermissionMap }, { uid: string }>(
    'createSubUser',
  ),
  updateSubUser: callable<
    { uid: string; fullName?: string; permissions?: PermissionMap; isActive?: boolean; password?: string },
    { ok: true }
  >('updateSubUser'),
  deleteSubUser: callable<{ uid: string }, { ok: true }>('deleteSubUser'),
  clearTenantData: callable<{ confirm: string }, { deleted: number }>('clearTenantData'),
  testTelegram: callable<Record<string, never>, { ok: true }>('testTelegram'),
  bootstrapSuperAdmin: callable<Record<string, never>, { ok: true }>('bootstrapSuperAdmin'),
  adminListAccounts: callable<Record<string, never>, { accounts: AdminAccount[] }>('adminListAccounts'),
  adminSetSubscription: callable<{ uid: string } & SubscriptionAction, { ok: true }>('adminSetSubscription'),
  adminDeleteAccount: callable<{ uid: string; confirm: string }, { ok: true }>('adminDeleteAccount'),
};
