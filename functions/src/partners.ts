/**
 * Marketing Partner & Client Assignment.
 *
 * NOT a commission/revenue-sharing feature — no financial calculations, payouts, or earnings
 * live here. This module only answers: who acquired a customer (immutable), and who is currently
 * responsible for it (Super Admin or a specific Marketing Partner), with a full audit trail.
 *
 * Security model:
 *  - `marketing_partner` is a distinct platform-level claim (functions/src/validate.ts,
 *    functions/src/claims.ts), never a tenant role and never a Super Admin.
 *  - A partner's assigned tenant set is NEVER embedded in the ID token (claims are size-limited
 *    and must stay fresh); it is resolved live, every call, from `platformClientAssignments`
 *    filtered by `assignedPartnerId == caller.uid`.
 *  - Every partner-facing read is a callable that itself decides which tenants to include — a
 *    partner is never handed a tenant id to look up arbitrarily, and never reads Firestore
 *    directly (firestore.rules denies all client access to every collection this file writes).
 *  - A referral code is validated against `platformReferrals/{code}` and resolved server-side to
 *    a `partnerId`; a client-submitted `partnerId` is never trusted or accepted as input anywhere
 *    in this module.
 *  - `acquisition` on `platformClientAssignments/{tenantId}` is written exactly once, at signup,
 *    and no callable in this module ever updates it afterwards — only `assignedTo` /
 *    `assignedPartnerId` change, and only through `adminAssignClient`.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import { REF_CODE_RE } from './salesModel.js';
import { caller, parse, requireMarketingPartner, requireSuperAdmin, trimmed } from './validate.js';

const AUDIT_COLLECTION = 'platformPartnerAuditLog';
const ASSIGNMENT_COLLECTION = 'platformClientAssignments';
const PARTNER_COLLECTION = 'marketingPartners';

async function audit(input: { actorUid: string; action: string; tenantId?: string; partnerId?: string; meta?: Record<string, unknown> }): Promise<void> {
  await db.collection(AUDIT_COLLECTION).add({ ...input, at: FieldValue.serverTimestamp(), atMs: Date.now() });
}

function assignmentRef(tenantId: string) {
  return db.doc(`${ASSIGNMENT_COLLECTION}/${tenantId}`);
}

function partnerRef(partnerUid: string) {
  return db.doc(`${PARTNER_COLLECTION}/${partnerUid}`);
}

/* ------------------------------------------------------------------ referral codes (signup-time) */

/**
 * Resolves a signup-time referral code to the partner that owns it, or null. Never trusts a
 * client-submitted partner id — only a code, looked up server-side against `platformReferrals`,
 * which must be `active` and carry a `partnerId` whose partner is itself still active.
 * Used by functions/src/account.ts::completeSignup; never exported to the client as-is.
 */
export async function resolvePartnerReferral(code: string | null | undefined): Promise<{ referralCode: string; partnerId: string } | null> {
  const trimmedCode = (code ?? '').trim();
  if (!trimmedCode || !REF_CODE_RE.test(trimmedCode)) return null;
  const snap = await db.doc(`platformReferrals/${trimmedCode}`).get();
  if (!snap.exists || snap.get('active') !== true) return null;
  const partnerId = snap.get('partnerId');
  if (typeof partnerId !== 'string' || !partnerId) return null;
  const partnerSnap = await partnerRef(partnerId).get();
  if (!partnerSnap.exists || partnerSnap.get('active') !== true) return null;
  return { referralCode: trimmedCode, partnerId };
}

/**
 * Creates the one-time, immutable assignment record for a brand-new tenant. Called right after
 * `completeSignup` writes the tenant (same convention as `grantEveryoneEntitlementsForNewTenant`:
 * best-effort post-transaction, not inside the signup transaction itself, so a failure here never
 * blocks account creation — it is reconciled by Super Admin from the "Unassigned" list instead).
 * A referred signup starts already assigned to that partner; an organic signup starts Unassigned.
 */
export async function createClientAssignmentForNewTenant(tenantId: string, referral: { referralCode: string; partnerId: string } | null): Promise<void> {
  const ref = assignmentRef(tenantId);
  const existing = await ref.get();
  if (existing.exists) return; // idempotent: completeSignup may be re-called for an already-set-up owner.
  const now = FieldValue.serverTimestamp();
  const nowMs = Date.now();
  await ref.set({
    tenantId,
    acquisition: referral
      ? { source: 'referral' as const, partnerId: referral.partnerId, referralCode: referral.referralCode, capturedAt: now, capturedAtMs: nowMs }
      : { source: 'direct' as const, partnerId: null, referralCode: null, capturedAt: now, capturedAtMs: nowMs },
    assignedTo: referral ? ('partner' as const) : null,
    assignedPartnerId: referral ? referral.partnerId : null,
    assignedBy: referral ? 'signup:referral' : null,
    assignedAt: now,
    updatedAtMs: nowMs,
  });
  await audit({
    actorUid: referral ? referral.partnerId : 'signup',
    action: referral ? 'signup-assigned-referral' : 'signup-unassigned',
    tenantId,
    ...(referral ? { partnerId: referral.partnerId } : {}),
  });
}

/* ------------------------------------------------------------------ Super Admin: partner management */

function generateReferralCode(seed: string): string {
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug || 'partner'}-${suffix}`;
}

const grantPartnerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: trimmed(120),
  contactAuthorized: z.boolean().default(false),
});

/** Creates (or re-activates) a marketing partner from an existing verified Auth account, by e-mail. */
export const grantMarketingPartner = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(grantPartnerSchema, request.data);
  const record = await auth.getUserByEmail(input.email).catch(() => null);
  if (!record) fail('not-found', 'error.fn.userNotFound');
  if (record!.customClaims?.superAdmin === true) fail('failed-precondition', 'error.partner.alreadySuperAdmin');
  if (record!.customClaims?.tenantId) fail('failed-precondition', 'error.partner.hasTenant');
  const uid = record!.uid;
  const existing = await partnerRef(uid).get();
  const referralCode = existing.exists && typeof existing.get('referralCode') === 'string' ? (existing.get('referralCode') as string) : generateReferralCode(input.name);

  const batch = db.batch();
  batch.set(
    partnerRef(uid),
    {
      uid,
      email: input.email,
      name: input.name,
      referralCode,
      contactAuthorized: input.contactAuthorized,
      active: true,
      createdAt: existing.exists ? existing.get('createdAt') : FieldValue.serverTimestamp(),
      createdBy: existing.exists ? existing.get('createdBy') : c.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: c.uid,
    },
    { merge: true },
  );
  batch.set(db.doc(`platformReferrals/${referralCode}`), { active: true, partnerId: uid, kind: 'partner' }, { merge: true });
  await batch.commit();

  await auth.setCustomUserClaims(uid, { ...(record!.customClaims ?? {}), marketingPartner: true });
  await audit({ actorUid: c.uid, action: existing.exists ? 'partner-reactivated' : 'partner-granted', partnerId: uid, meta: { email: input.email } });
  return { ok: true as const, partnerId: uid, referralCode };
});

interface PartnerRow {
  uid: string;
  email: string;
  name: string;
  referralCode: string;
  contactAuthorized: boolean;
  active: boolean;
  createdAtMs: number | null;
}

/** Super Admin only. Lists every Marketing Partner account (active and revoked) for management. */
export const adminListPartners = onCall({ region: REGION }, async (request) => {
  requireSuperAdmin(caller(request));
  const snap = await db.collection(PARTNER_COLLECTION).orderBy('createdAt', 'desc').get();
  const partners: PartnerRow[] = snap.docs.map((d) => {
    const p = d.data();
    return {
      uid: d.id,
      email: String(p.email ?? ''),
      name: String(p.name ?? ''),
      referralCode: String(p.referralCode ?? ''),
      contactAuthorized: p.contactAuthorized === true,
      active: p.active === true,
      createdAtMs: typeof p.createdAt?.toMillis === 'function' ? p.createdAt.toMillis() : null,
    };
  });
  return { partners };
});

/* ------------------------------------------------------------------ one-time backfill */

/**
 * Backfills `platformClientAssignments` for every tenant that existed BEFORE this feature
 * shipped (completeSignup only writes this doc for brand-new signups going forward). Every
 * backfilled tenant lands exactly where an organic, non-referred signup would: `direct`
 * acquisition, Unassigned. Idempotent — safe to run more than once, and safe to run while new
 * signups are happening (each one checks `existing.exists` before writing, same as
 * createClientAssignmentForNewTenant). Super Admin only; never touches a tenant that already
 * has an assignment doc, so it can never overwrite real attribution or a manual assignment.
 */
export const adminBackfillClientAssignments = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);

  const storesSnap = await db.collection('stores').select().get();
  const tenantIds = storesSnap.docs.map((d) => d.id);
  if (tenantIds.length === 0) return { scanned: 0, created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;
  const CHUNK = 300; // Firestore getAll/batch limits — process in chunks for large stores collections.
  for (let i = 0; i < tenantIds.length; i += CHUNK) {
    const chunk = tenantIds.slice(i, i + CHUNK);
    const existingSnaps = await db.getAll(...chunk.map((t) => assignmentRef(t)));
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    const nowMs = Date.now();
    let chunkCreated = 0;
    existingSnaps.forEach((snap, idx) => {
      if (snap.exists) {
        skipped += 1;
        return;
      }
      const tenantId = chunk[idx];
      if (tenantId === undefined) return;
      batch.set(assignmentRef(tenantId), {
        tenantId,
        acquisition: { source: 'direct' as const, partnerId: null, referralCode: null, capturedAt: now, capturedAtMs: nowMs },
        assignedTo: null,
        assignedPartnerId: null,
        assignedBy: null,
        assignedAt: now,
        updatedAtMs: nowMs,
      });
      chunkCreated += 1;
    });
    if (chunkCreated > 0) await batch.commit();
    created += chunkCreated;
  }

  await audit({ actorUid: c.uid, action: 'backfill-client-assignments', meta: { scanned: tenantIds.length, created, skipped } });
  return { scanned: tenantIds.length, created, skipped };
});

const revokePartnerSchema = z.object({ partnerId: trimmed(128) });

/** Revokes a partner's access immediately (claim cleared, referral code deactivated). History and existing client assignments are preserved untouched. */
export const revokeMarketingPartner = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(revokePartnerSchema, request.data);
  const snap = await partnerRef(input.partnerId).get();
  if (!snap.exists) fail('not-found', 'error.partner.missing');
  const referralCode = snap.get('referralCode');

  const batch = db.batch();
  batch.update(partnerRef(input.partnerId), { active: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid });
  if (typeof referralCode === 'string' && referralCode) batch.set(db.doc(`platformReferrals/${referralCode}`), { active: false }, { merge: true });
  await batch.commit();

  const record = await auth.getUser(input.partnerId).catch(() => null);
  if (record) {
    const { marketingPartner: _drop, ...rest } = record.customClaims ?? {};
    await auth.setCustomUserClaims(input.partnerId, Object.keys(rest).length ? rest : null);
    await auth.revokeRefreshTokens(input.partnerId).catch(() => undefined);
  }
  await audit({ actorUid: c.uid, action: 'partner-revoked', partnerId: input.partnerId });
  return { ok: true as const };
});

/* ------------------------------------------------------------------ Super Admin: client assignment */

const listSchema = z.object({
  group: z.enum(['all', 'mine', 'partner', 'unassigned']).default('all'),
  search: z.string().trim().max(120).default(''),
  partnerId: z.string().trim().max(128).optional(),
});

interface ClientRow {
  tenantId: string;
  storeName: string;
  ownerEmail: string;
  ownerName: string;
  createdAtMs: number | null;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'unknown';
  acquisition: { source: 'referral' | 'direct'; partnerId: string | null; referralCode: string | null };
  assignedTo: 'superAdmin' | 'partner' | null;
  assignedPartnerId: string | null;
  assignedBy: string | null;
  assignedAtMs: number | null;
}

function subscriptionStatusOf(sub: FirebaseFirestore.DocumentData | undefined): ClientRow['subscriptionStatus'] {
  if (!sub) return 'unknown';
  if (sub.lifetime === true) return 'active';
  const endsAtMs = typeof sub.endsAt?.toMillis === 'function' ? sub.endsAt.toMillis() : null;
  if (endsAtMs !== null && endsAtMs <= Date.now()) return 'expired';
  if (sub.trial === true) return 'trial';
  return sub.activated === true ? 'active' : 'unknown';
}

/** Super Admin only. Lists every customer tenant with its current + original attribution, server-filtered. */
export const adminListClientAssignments = onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(listSchema, request.data);

  const assignmentsSnap = await db.collection(ASSIGNMENT_COLLECTION).get();
  let docs = assignmentsSnap.docs;
  if (input.group === 'unassigned') docs = docs.filter((d) => !d.get('assignedTo'));
  else if (input.group === 'mine') docs = docs.filter((d) => d.get('assignedTo') === 'superAdmin');
  else if (input.group === 'partner') {
    docs = input.partnerId ? docs.filter((d) => d.get('assignedPartnerId') === input.partnerId) : docs.filter((d) => d.get('assignedTo') === 'partner');
  }

  const tenantIds = docs.map((d) => d.id);
  const [storeSnaps, subSnaps] = await Promise.all([
    tenantIds.length ? db.getAll(...tenantIds.map((t) => db.doc(`stores/${t}`))) : Promise.resolve([]),
    tenantIds.length ? db.getAll(...tenantIds.map((t) => db.doc(`subscriptions/${t}`))) : Promise.resolve([]),
  ]);
  const storeOf = new Map(storeSnaps.map((s) => [s.id, s.data()]));
  const subOf = new Map(subSnaps.map((s) => [s.id, s.data()]));

  const needle = input.search.toLowerCase();
  const rows: ClientRow[] = docs
    .map((d) => {
      const a = d.data();
      const store = storeOf.get(d.id);
      const sub = subOf.get(d.id);
      const createdAtMs = typeof store?.createdAt?.toMillis === 'function' ? store.createdAt.toMillis() : null;
      const assignedAtMs = typeof a.assignedAt?.toMillis === 'function' ? a.assignedAt.toMillis() : null;
      return {
        tenantId: d.id,
        storeName: String(store?.storeName ?? ''),
        ownerEmail: String(store?.ownerEmail ?? ''),
        ownerName: String(store?.ownerName ?? ''),
        createdAtMs,
        subscriptionStatus: subscriptionStatusOf(sub),
        acquisition: {
          source: a.acquisition?.source === 'referral' ? 'referral' : 'direct',
          partnerId: a.acquisition?.partnerId ?? null,
          referralCode: a.acquisition?.referralCode ?? null,
        },
        assignedTo: a.assignedTo === 'partner' || a.assignedTo === 'superAdmin' ? a.assignedTo : null,
        assignedPartnerId: a.assignedPartnerId ?? null,
        assignedBy: a.assignedBy ?? null,
        assignedAtMs,
      } satisfies ClientRow;
    })
    .filter((row) => !needle || row.storeName.toLowerCase().includes(needle) || row.ownerEmail.toLowerCase().includes(needle) || row.ownerName.toLowerCase().includes(needle));

  return { rows };
});

const assignSchema = z.object({
  tenantId: trimmed(128),
  assignTo: z.enum(['superAdmin', 'partner']),
  partnerId: z.string().trim().max(128).optional(),
  confirm: trimmed(160),
});

/**
 * Assigns an unassigned tenant, or transfers an already-assigned one, to Super Admin ("myself") or
 * to a named active partner. One function covers both the spec's "assign" and "transfer" actions —
 * both are the same state change, and both require the same typed confirmation and the same audit
 * entry. `acquisition` (how the tenant was originally acquired) is never touched here.
 */
export const adminAssignClient = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(assignSchema, request.data);
  if (input.assignTo === 'partner' && !input.partnerId) fail('invalid-argument', 'error.invalidInput');

  const ref = assignmentRef(input.tenantId);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'error.partner.tenantUnknown');

  if (input.assignTo === 'partner') {
    const targetPartner = await partnerRef(input.partnerId!).get();
    if (!targetPartner.exists || targetPartner.get('active') !== true) fail('failed-precondition', 'error.partner.inactive');
  }
  const expectedConfirm = input.assignTo === 'partner' ? `ASSIGN ${input.tenantId} TO PARTNER ${input.partnerId}` : `ASSIGN ${input.tenantId} TO MYSELF`;
  if (input.confirm !== expectedConfirm) fail('failed-precondition', 'error.fn.confirmMismatch');

  const before = snap.data();
  const from = { assignedTo: before?.assignedTo ?? null, assignedPartnerId: before?.assignedPartnerId ?? null };
  const to = { assignedTo: input.assignTo, assignedPartnerId: input.assignTo === 'partner' ? input.partnerId! : null };
  if (from.assignedTo === to.assignedTo && from.assignedPartnerId === to.assignedPartnerId) {
    fail('failed-precondition', 'error.partner.noChange');
  }

  await ref.update({
    assignedTo: to.assignedTo,
    assignedPartnerId: to.assignedPartnerId,
    assignedBy: c.uid,
    assignedAt: FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  });
  await audit({ actorUid: c.uid, action: from.assignedTo ? 'transferred' : 'assigned', tenantId: input.tenantId, ...(to.assignedPartnerId ? { partnerId: to.assignedPartnerId } : {}), meta: { from, to } });
  return { ok: true as const };
});

const auditListSchema = z.object({ tenantId: z.string().trim().max(128).optional(), limit: z.number().int().min(1).max(200).default(50) });

/** Super Admin only. Full assignment history for one tenant, or the most recent entries overall. */
export const adminListClientAssignmentAudit = onCall({ region: REGION }, async (request) => {
  requireSuperAdmin(caller(request));
  const input = parse(auditListSchema, request.data);
  let q = db.collection(AUDIT_COLLECTION).orderBy('atMs', 'desc').limit(input.limit) as FirebaseFirestore.Query;
  if (input.tenantId) q = db.collection(AUDIT_COLLECTION).where('tenantId', '==', input.tenantId).orderBy('atMs', 'desc').limit(input.limit);
  const snap = await q.get();
  return { entries: snap.docs.map((d) => ({ id: d.id, ...d.data(), at: undefined })) };
});

/* ------------------------------------------------------------------ Marketing Partner dashboard */

interface PartnerClientRow {
  tenantId: string;
  storeName: string;
  signupAtMs: number | null;
  subscriptionStatus: ClientRow['subscriptionStatus'];
  activationStatus: 'active' | 'inactive';
  contact: { email: string; phone: string } | null;
}

/**
 * Marketing Partner only. Resolves the caller's assigned tenants live (never from claims), and
 * returns only the fields the spec allows — never POS sales, inventory or financial data, never
 * contact details unless this partner's own `contactAuthorized` flag is true.
 */
export const partnerListMyClients = onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
  const c = caller(request);
  requireMarketingPartner(c);
  const partnerSnap = await partnerRef(c.uid).get();
  if (!partnerSnap.exists || partnerSnap.get('active') !== true) fail('permission-denied', 'error.fn.notAllowed');
  const contactAuthorized = partnerSnap.get('contactAuthorized') === true;

  const assignedSnap = await db.collection(ASSIGNMENT_COLLECTION).where('assignedPartnerId', '==', c.uid).where('assignedTo', '==', 'partner').get();
  const tenantIds = assignedSnap.docs.map((d) => d.id);
  if (tenantIds.length === 0) return { clients: [] as PartnerClientRow[] };

  const [storeSnaps, subSnaps, userActiveSnaps] = await Promise.all([
    db.getAll(...tenantIds.map((t) => db.doc(`stores/${t}`))),
    db.getAll(...tenantIds.map((t) => db.doc(`subscriptions/${t}`))),
    db.getAll(...tenantIds.map((t) => db.doc(`users/${t}`))),
  ]);
  const storeOf = new Map(storeSnaps.map((s) => [s.id, s.data()]));
  const subOf = new Map(subSnaps.map((s) => [s.id, s.data()]));
  const userOf = new Map(userActiveSnaps.map((s) => [s.id, s.data()]));

  const clients: PartnerClientRow[] = tenantIds.map((tenantId) => {
    const store = storeOf.get(tenantId);
    const user = userOf.get(tenantId);
    return {
      tenantId,
      storeName: String(store?.storeName ?? ''),
      signupAtMs: typeof store?.createdAt?.toMillis === 'function' ? store.createdAt.toMillis() : null,
      subscriptionStatus: subscriptionStatusOf(subOf.get(tenantId)),
      activationStatus: user?.isActive === false ? 'inactive' : 'active',
      contact: contactAuthorized ? { email: String(store?.ownerEmail ?? ''), phone: String(store?.phone ?? '') } : null,
    };
  });
  return { clients };
});
