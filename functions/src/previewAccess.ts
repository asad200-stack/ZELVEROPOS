import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import { posAdjustDrawer, posCashMove } from './pos/cash.js';
import { posAdjustDebt, posCreateCustomer, posPayDebt } from './pos/customers.js';
import { posAdjustStock, posCreateProduct, posDeleteProduct, posImportProducts, posSetProductStatus } from './pos/inventory.js';
import { posCheckout, posReturn } from './pos/sales.js';
import { posCreatePurchase, posPaySupplier, posReturnToSupplier } from './pos/suppliers.js';
import { runWithPreviewBinding } from './previewContext.js';
import { caller, parse, requireSuperAdmin } from './validate.js';

const GRANT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * POS operations the preview credential may run. Release cutover is intentionally absent:
 * assignReleaseTenants and releaseToEveryone stay on the normal Super Admin token only.
 */
const PREVIEW_OPERATIONS = {
  posCheckout,
  posReturn,
  posCreateProduct,
  posImportProducts,
  posSetProductStatus,
  posDeleteProduct,
  posAdjustStock,
  posCreateCustomer,
  posPayDebt,
  posAdjustDebt,
  posCashMove,
  posAdjustDrawer,
  posCreatePurchase,
  posPaySupplier,
  posReturnToSupplier,
} as const;

type PreviewOperation = keyof typeof PREVIEW_OPERATIONS;

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function secretMatches(storedHex: string, provided: string): boolean {
  const stored = Buffer.from(storedHex, 'hex');
  const given = Buffer.from(hashSecret(provided), 'hex');
  return stored.length === given.length && timingSafeEqual(stored, given);
}

/**
 * The internal demo tenant is the caller's own uid, and only when both the profile and the
 * subscription were marked by adminProvisionInternalDemo. A tenant id in the request is ignored.
 */
async function resolveInternalDemoTenant(uid: string): Promise<string> {
  const [user, subscription] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`subscriptions/${uid}`).get()]);
  if (user.get('internalDemo') !== true || user.get('tenantId') !== uid || subscription.get('internalDemo') !== true) {
    fail('permission-denied', 'error.fn.notAllowed');
  }
  return uid;
}

async function verifiedSuperAdmin(uid: string): Promise<void> {
  const record = await auth.getUser(uid);
  if (record.customClaims?.superAdmin !== true || record.emailVerified !== true) fail('permission-denied', 'error.fn.notAllowed');
}

/** A preview session is this stored secret, not the caller's ordinary ID token. */
export const issuePreviewCredential = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  await verifiedSuperAdmin(c.uid);
  const tenantId = await resolveInternalDemoTenant(c.uid);
  const credentialId = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const expiresAtMs = Date.now() + GRANT_TTL_MS;
  await db.doc(`platformPreviewCredentials/${credentialId}`).set({
    uid: c.uid,
    tenantId,
    secretHash: hashSecret(secret),
    expiresAtMs,
    createdAtMs: Date.now(),
  });
  return { credentialId, secret, tenantId, expiresAtMs };
});

const previewCallSchema = z.object({
  credentialId: z.string().trim().regex(/^[a-f0-9]{32}$/),
  secret: z.string().trim().regex(/^[a-f0-9]{64}$/),
  operation: z.string().trim().min(1).max(64),
  payload: z.record(z.string(), z.unknown()).default({}),
});

function isPreviewOperation(name: string): name is PreviewOperation {
  return Object.prototype.hasOwnProperty.call(PREVIEW_OPERATIONS, name);
}

function withoutTenantSelection(payload: Record<string, unknown>, request: CallableRequest): Record<string, unknown> {
  const data = { ...payload };
  delete data.tenantId;
  delete data.tenantIds;
  delete data.credentialId;
  delete data.secret;
  delete data.operation;
  const raw = request.data as { clientApiVersion?: unknown; clientReleaseVersion?: unknown };
  if (data.clientApiVersion == null && raw?.clientApiVersion != null) data.clientApiVersion = raw.clientApiVersion;
  if (data.clientReleaseVersion == null && raw?.clientReleaseVersion != null) data.clientReleaseVersion = raw.clientReleaseVersion;
  return data;
}

export const previewPos = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const raw = { ...(request.data as Record<string, unknown>) };
  delete raw.clientApiVersion;
  delete raw.clientReleaseVersion;
  const input = parse(previewCallSchema, raw);
  if (!isPreviewOperation(input.operation)) fail('invalid-argument', 'error.invalidInput');
  const operation = input.operation;
  await verifiedSuperAdmin(c.uid);
  const tenantId = await resolveInternalDemoTenant(c.uid);
  const grant = await db.doc(`platformPreviewCredentials/${input.credentialId}`).get();
  if (!grant.exists) fail('permission-denied', 'error.fn.notAllowed');
  if (grant.get('uid') !== c.uid || grant.get('tenantId') !== tenantId) fail('permission-denied', 'error.fn.notAllowed');
  if (Number(grant.get('expiresAtMs')) <= Date.now()) fail('permission-denied', 'error.fn.notAllowed');
  if (!secretMatches(String(grant.get('secretHash') ?? ''), input.secret)) fail('permission-denied', 'error.fn.notAllowed');

  const inner = Object.assign({}, request, { data: withoutTenantSelection(input.payload, request) }) as CallableRequest;
  return runWithPreviewBinding({ uid: c.uid, tenantId }, () => PREVIEW_OPERATIONS[operation].run(inner) as Promise<unknown>);
});
