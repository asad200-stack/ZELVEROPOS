import { z } from 'zod';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { fail } from './errors.js';

/** Parses callable input with zod; invalid input is a client error, never a crash. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) fail('invalid-argument', 'error.invalidInput');
  return result.data;
}

export interface Caller {
  uid: string;
  email: string;
  emailVerified: boolean;
  tenantId: string | null;
  role: 'owner' | 'subUser' | null;
  perms: Record<string, boolean>;
  superAdmin: boolean;
  /**
   * Platform-level marketing-partner role. Spans multiple tenants it is assigned to (never its
   * own tenant), so — unlike `perms` — it carries no tenant list in the token: the set of
   * assigned tenants is always resolved live from `platformClientAssignments` by caller uid.
   */
  marketingPartner: boolean;
  active: boolean;
}

export function caller(request: CallableRequest): Caller {
  const a = request.auth;
  if (!a) fail('unauthenticated', 'error.unauthenticated');
  const t = a.token as Record<string, unknown>;
  return {
    uid: a.uid,
    email: typeof t.email === 'string' ? t.email.toLowerCase() : '',
    emailVerified: t.email_verified === true,
    tenantId: typeof t.tenantId === 'string' ? t.tenantId : null,
    role: t.role === 'owner' || t.role === 'subUser' ? t.role : null,
    perms: (t.perms && typeof t.perms === 'object' ? t.perms : {}) as Record<string, boolean>,
    superAdmin: t.superAdmin === true,
    marketingPartner: t.marketingPartner === true,
    active: t.active === true,
  };
}

/** The caller must be the active owner of its tenant; returns the tenant id. */
export function requireOwner(c: Caller): string {
  if (!c.tenantId || c.role !== 'owner' || !c.active) fail('permission-denied', 'error.fn.notOwner');
  return c.tenantId;
}

export function requireSuperAdmin(c: Caller): void {
  if (!c.superAdmin || !c.emailVerified) fail('permission-denied', 'error.fn.notAllowed');
}

/** The caller must hold the marketing_partner claim (never granted together with tenant membership). */
export function requireMarketingPartner(c: Caller): void {
  if (!c.marketingPartner || !c.emailVerified) fail('permission-denied', 'error.fn.notAllowed');
}

export const trimmed = (max: number) => z.string().trim().min(1).max(max);
