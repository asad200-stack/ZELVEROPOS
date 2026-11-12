import { FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { syncUserClaims } from './claims.js';
import { DAY_MS, REGION, WEBSITE_SALES_MODE } from './config.js';
import { fail } from './errors.js';
import {
  REF_CODE_RE,
  contactSchema,
  emailKey,
  ipSignal,
  mergeLeadStatus,
  newSubdomain,
  newTenantId,
  normalizeEmail,
  phoneKey,
  quoteSchema,
  trialSchema,
  type ContactInput,
  type LeadSource,
  type LeadStatus,
  type QuoteInput,
} from './salesModel.js';
import { caller, parse, requireSuperAdmin } from './validate.js';
import { rethrowClientSafe } from './errors.js';
import { platformClientIp } from './requestIp.js';
import { runtimeProjectId, websiteSalesWriteDecision } from './salesGuard.js';
import { readPublicLead, salesBody } from './salesInput.js';
import { displayedTrialStatus, publicTrialResult, trialDeliveryAllowed, trialSignupAllowed } from './trialAccess.js';
import { planTrialExpiry, trialExpiryAuditId } from './trialExpiry.js';
import { tenantIdReserved, type CleanupRecord } from './storageCleanup.js';

type SalesMode = 'off' | 'staging' | 'on';

function emulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

const TENANT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Emulator tests can force the ids tried while allocating a tenant. Production never reads this. */
async function emulatorTenantCandidates(): Promise<string[] | null> {
  if (!emulator()) return null;
  const ref = db.doc('platformTestHooks/tenantAllocation');
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.delete();
  const ids = snap.get('ids');
  if (!Array.isArray(ids)) return null;
  return ids.filter((id): id is string => typeof id === 'string' && TENANT_ID.test(id));
}

/** Picks an id that has no cleanup reservation and no live tenant document. */
async function reserveFreshTenantId(tx: Transaction, preferred: string[] | null): Promise<string> {
  const candidates = preferred?.length
    ? preferred
    : [newTenantId(), newTenantId(), newTenantId(), newTenantId(), newTenantId()];
  for (const id of candidates) {
    const cleanup = await tx.get(db.doc(`platformStorageCleanup/${id}`));
    if (tenantIdReserved(cleanup.exists ? cleanup.data() as CleanupRecord : undefined)) continue;
    const existing = await tx.get(db.doc(`tenants/${id}`));
    if (existing.exists) continue;
    return id;
  }
  fail('failed-precondition', 'error.fn.trialUnavailable');
}

async function salesMode(): Promise<SalesMode> {
  const snap = await db.doc('platform/salesConfig').get();
  const fromDoc = snap.get('mode');
  if (fromDoc === 'off' || fromDoc === 'staging' || fromDoc === 'on') return fromDoc;
  const p = WEBSITE_SALES_MODE.value();
  if (p === 'off' || p === 'on' || p === 'staging') return p;
  return emulator() ? 'on' : 'staging';
}

function requireIntake(mode: SalesMode): void {
  if (mode === 'off') fail('failed-precondition', 'error.fn.salesBackendDisabled');
}

function trialAllowed(mode: SalesMode, email: string): boolean {
  return trialSignupAllowed(mode, email) && trialDeliveryAllowed(email);
}

function headerValue(request: CallableRequest, name: string): string | null {
  const raw = request.rawRequest?.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : null;
}

/** Uses the server project id only. Runs before rate limits, Auth creates, and Firestore writes. */
function refuseProductionTestWrite(request: CallableRequest): void {
  const data = request.data as { email?: unknown } | null | undefined;
  const email = data && typeof data.email === 'string' ? data.email : '';
  const decision = websiteSalesWriteDecision({
    projectId: runtimeProjectId(),
    origin: headerValue(request, 'origin'),
    referer: headerValue(request, 'referer') ?? headerValue(request, 'referrer'),
    email,
    emulator: emulator(),
  });
  if (!decision.allow) fail('failed-precondition', 'error.fn.salesBackendDisabled');
}

function clientIp(request: CallableRequest): string {
  const raw = request.rawRequest;
  return platformClientIp({
    forwardedFor: raw?.headers?.['x-forwarded-for'],
    socketAddress: raw?.socket?.remoteAddress,
  });
}

function hourBucket(now: number): string {
  return String(Math.floor(now / 3_600_000));
}

async function rateLimit(kind: string, ip: string, now: number, max: number): Promise<void> {
  const ref = db.doc(`platformRateLimits/${kind}_${ipSignal(ip)}_${hourBucket(now)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.get('count') ?? 0);
    if (count >= max) fail('resource-exhausted', 'error.tooManyRequests');
    tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

function assertNotSpam(input: { website?: string; formStartedAt: number }, now: number): void {
  if (input.website && input.website.trim()) fail('invalid-argument', 'error.invalidInput');
  const age = now - input.formStartedAt;
  if (age < 400 || age > 24 * 3_600_000) fail('invalid-argument', 'error.invalidInput');
}

async function validReferral(code: string | undefined): Promise<string | null> {
  const trimmed = (code ?? '').trim();
  if (!trimmed || !REF_CODE_RE.test(trimmed)) return null;
  const snap = await db.doc(`platformReferrals/${trimmed}`).get();
  if (!snap.exists || snap.get('active') !== true) return null;
  return trimmed;
}

async function writeAudit(action: string, meta: Record<string, unknown>): Promise<void> {
  const safe = { ...meta };
  delete safe.password;
  await db.collection('platformAudit').add({
    action,
    ...safe,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function replayOp(tx: Transaction, id: string): Promise<DocumentData | null> {
  const snap = await tx.get(db.doc(`platformSalesOps/${id}`));
  if (!snap.exists) return null;
  return (snap.get('result') as DocumentData) ?? {};
}

function storeOp(tx: Transaction, id: string, kind: string, result: Record<string, unknown>): void {
  tx.set(db.doc(`platformSalesOps/${id}`), {
    kind,
    result,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function quoteReference(): string {
  return `ZV-Q-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function upsertLead(
  tx: Transaction,
  input: {
    name: string;
    businessName: string;
    email: string;
    phone: string;
    businessType: string;
    country?: string;
    source: LeadSource;
    status: LeadStatus;
    referralCode: string | null;
    interestedFeatures?: string[];
    note?: string;
    preferredContact?: string;
  },
): Promise<{ leadId: string; created: boolean }> {
  const ek = emailKey(input.email);
  const pk = phoneKey(input.phone);
  const emailIdx = db.doc(`platformLeadIndex/email_${ek}`);
  const phoneIdx = pk ? db.doc(`platformLeadIndex/phone_${pk}`) : null;
  const emailSnap = await tx.get(emailIdx);
  let leadId = emailSnap.exists ? String(emailSnap.get('leadId') ?? '') : '';
  if (!leadId && phoneIdx) {
    const phoneSnap = await tx.get(phoneIdx);
    leadId = phoneSnap.exists ? String(phoneSnap.get('leadId') ?? '') : '';
  }
  const created = !leadId;
  const ref = leadId ? db.doc(`platformLeads/${leadId}`) : db.collection('platformLeads').doc();
  leadId = ref.id;
  const existing = created ? undefined : (await tx.get(ref)).data();
  const status = mergeLeadStatus(existing?.status as LeadStatus | undefined, input.status);
  const now = FieldValue.serverTimestamp();
  tx.set(
    ref,
    {
      name: input.name,
      businessName: input.businessName,
      email: normalizeEmail(input.email),
      emailKey: ek,
      phone: input.phone,
      phoneKey: pk,
      businessType: input.businessType,
      country: input.country ?? '',
      source: existing?.source ?? input.source,
      lastSource: input.source,
      status,
      referralCode: input.referralCode ?? existing?.referralCode ?? null,
      interestedFeatures: input.interestedFeatures ?? existing?.interestedFeatures ?? [],
      preferredContact: input.preferredContact ?? existing?.preferredContact ?? null,
      notes: input.note || existing?.notes || '',
      assignedTo: existing?.assignedTo ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
    { merge: true },
  );
  tx.set(emailIdx, { leadId, emailKey: ek, updatedAt: now }, { merge: true });
  if (phoneIdx && pk) tx.set(phoneIdx, { leadId, phoneKey: pk, updatedAt: now }, { merge: true });
  return { leadId, created };
}

const publicFn = { region: REGION, enforceAppCheck: false as const, cors: true };

export const submitWebsiteLead = onCall(publicFn, async (request) => {
  try {
    refuseProductionTestWrite(request);
    const mode = await salesMode();
    requireIntake(mode);
    const { source, body } = readPublicLead(request.data);
    const now = Date.now();
    await rateLimit('lead', clientIp(request), now, 30);

    if (source === 'quote') {
      const input = parse(quoteSchema, body);
      assertNotSpam(input, now);
      return await submitQuote(input);
    }
    const input = parse(contactSchema, body);
    assertNotSpam(input, now);
    return await submitContact(input, source);
  } catch (err) {
    rethrowClientSafe(err);
  }
});

async function submitContact(input: ContactInput, source: LeadSource) {
  const referralCode = await validReferral(input.referralCode);
  const status: LeadStatus = source === 'demo_request' ? 'DEMO' : source === 'partner_referral' ? 'NEW' : 'NEW';
  let result: Record<string, unknown> = {};
  await db.runTransaction(async (tx) => {
    const replay = await replayOp(tx, input.clientOperationId);
    if (replay) {
      result = replay;
      return;
    }
    const { leadId, created } = await upsertLead(tx, {
      name: input.name,
      businessName: input.businessName,
      email: input.email,
      phone: input.phone,
      businessType: input.businessType,
      country: input.country,
      source,
      status,
      referralCode,
      interestedFeatures: input.interestedFeatures,
      note: input.note,
      preferredContact: input.preferredContact,
    });
    result = { ok: true, leadId, duplicate: !created, referralAccepted: Boolean(referralCode) };
    storeOp(tx, input.clientOperationId, source, result);
    tx.set(db.collection('platformAudit').doc(), {
      action: created ? 'lead_created' : 'lead_updated',
      leadId,
      source,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return result;
}

async function submitQuote(input: QuoteInput) {
  const referralCode = await validReferral(input.referralCode);
  let result: Record<string, unknown> = {};
  await db.runTransaction(async (tx) => {
    const replay = await replayOp(tx, input.clientOperationId);
    if (replay) {
      result = replay;
      return;
    }
    const { leadId, created } = await upsertLead(tx, {
      name: input.name,
      businessName: input.businessName,
      email: input.email,
      phone: input.phone,
      businessType: input.businessType,
      country: input.country,
      source: 'quote',
      status: 'QUOTE',
      referralCode,
      interestedFeatures: input.features,
      note: input.specialRequirements,
    });
    const quoteRef = db.collection('platformQuotes').doc();
    const reference = quoteReference();
    tx.set(quoteRef, {
      leadId,
      reference,
      status: 'REQUESTED',
      businessType: input.businessType,
      branches: input.branches,
      users: input.users,
      posDevices: input.posDevices,
      features: input.features,
      specialRequirements: input.specialRequirements,
      name: input.name,
      email: normalizeEmail(input.email),
      phone: input.phone,
      referralCode,
      createdAt: FieldValue.serverTimestamp(),
    });
    result = {
      ok: true,
      leadId,
      quoteId: quoteRef.id,
      reference,
      duplicate: !created,
      referralAccepted: Boolean(referralCode),
    };
    storeOp(tx, input.clientOperationId, 'quote', result);
    tx.set(db.collection('platformAudit').doc(), {
      action: 'quote_requested',
      leadId,
      quoteId: quoteRef.id,
      reference,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return result;
}

async function recordOwnedAuthUser(uid: string, email: string, clientOperationId: string): Promise<void> {
  const stateRef = db.doc(`platformProvisionState/${uid}`);
  await db.runTransaction(async (tx) => {
    const [state, profile] = await Promise.all([tx.get(stateRef), tx.get(db.doc(`users/${uid}`))]);
    if (profile.exists || state.get('status') === 'ready') return;
    tx.set(stateRef, {
      status: 'auth_created',
      emailKey: emailKey(email),
      clientOperationId,
      createdByOperation: clientOperationId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

/**
 * Deletes an Auth user only when this operation created it and neither a profile nor a trial
 * index refers to it. A failed transaction must not remove someone else's account or a
 * provision that has already reached `ready`.
 */
async function releaseFailedAuthAttempt(options: {
  uid: string;
  email: string;
  clientOperationId: string;
  createdByThisCall: boolean;
}): Promise<void> {
  if (!options.createdByThisCall) return;
  const userRef = db.doc(`users/${options.uid}`);
  const stateRef = db.doc(`platformProvisionState/${options.uid}`);
  const uidIdx = db.doc(`platformTrialIndex/uid_${options.uid}`);
  const owned = await db.runTransaction(async (tx) => {
    const [profile, state, idx] = await Promise.all([tx.get(userRef), tx.get(stateRef), tx.get(uidIdx)]);
    if (profile.exists || idx.exists || state.get('status') === 'ready') return false;
    if (String(state.get('createdByOperation') ?? '') !== options.clientOperationId) return false;
    tx.set(stateRef, {
      status: 'auth_created',
      emailKey: emailKey(options.email),
      clientOperationId: options.clientOperationId,
      createdByOperation: options.clientOperationId,
      error: 'tenant_failed',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!owned) return;
  const [profile, idx, state] = await Promise.all([userRef.get(), uidIdx.get(), stateRef.get()]);
  if (profile.exists || idx.exists || state.get('status') === 'ready') return;
  if (String(state.get('createdByOperation') ?? '') !== options.clientOperationId) return;
  try {
    await auth.deleteUser(options.uid);
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }
  await db.runTransaction(async (tx) => {
    const [profileNow, stateNow, idxNow] = await Promise.all([tx.get(userRef), tx.get(stateRef), tx.get(uidIdx)]);
    if (profileNow.exists || idxNow.exists || stateNow.get('status') === 'ready') return;
    if (String(stateNow.get('createdByOperation') ?? '') !== options.clientOperationId) return;
    tx.delete(stateRef);
  });
}

export const provisionWebsiteTrial = onCall({ ...publicFn, timeoutSeconds: 120 }, async (request) => {
  try {
  refuseProductionTestWrite(request);
  const mode = await salesMode();
  requireIntake(mode);
  const body = salesBody(request.data);
  const input = parse(trialSchema, { ...body, name: body.ownerName });
  const now = Date.now();
  assertNotSpam(input, now);
  await rateLimit('trial', clientIp(request), now, 8);
  const email = normalizeEmail(input.email);
  if (!trialAllowed(mode, email)) fail('failed-precondition', 'error.fn.trialNotOpen');

  const existingOp = await db.doc(`platformSalesOps/${input.clientOperationId}`).get();
  if (existingOp.exists) return publicTrialResult(existingOp.get('result') as Record<string, unknown>);

  const referralCode = await validReferral(input.referralCode);
  const emailIdx = db.doc(`platformTrialIndex/email_${emailKey(email)}`);
  const emailIdxSnap = await emailIdx.get();
  if (emailIdxSnap.exists) fail('failed-precondition', 'error.fn.trialUnavailable');

  try {
    // An existing Auth user is never attached to a new tenant. See orphanAuthRecovery.ts.
    await auth.getUserByEmail(email);
    fail('failed-precondition', 'error.fn.trialUnavailable');
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
  }

  let ownerUid: string;
  try {
    // A submitted password does not prove the mailbox belongs to the caller.
    const created = await auth.createUser({
      email,
      password: input.password,
      displayName: input.ownerName,
      emailVerified: false,
    });
    ownerUid = created.uid;
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/email-already-exists') {
      fail('failed-precondition', 'error.fn.trialUnavailable');
    }
    throw e;
  }
  const createdByThisCall = true;
  let tenantId = '';
  let result: Record<string, unknown> = {};

  try {
    await recordOwnedAuthUser(ownerUid, email, input.clientOperationId);
    if (emulator() && body.provisionFault === 'after-auth') throw new Error('provision fault after auth');
    const preferredTenantIds = await emulatorTenantCandidates();
    await db.runTransaction(async (tx) => {
      const replay = await replayOp(tx, input.clientOperationId);
      if (replay) {
        result = replay;
        tenantId = String(replay.tenantId ?? '');
        return;
      }
      const taken = await tx.get(emailIdx);
      if (taken.exists) fail('failed-precondition', 'error.fn.trialUnavailable');
      const userSnap = await tx.get(db.doc(`users/${ownerUid}`));
      if (userSnap.exists) fail('failed-precondition', 'error.fn.trialUnavailable');

      tenantId = await reserveFreshTenantId(tx, preferredTenantIds);
      let subdomain = newSubdomain(input.businessName);
      let subRef = db.doc(`storeSubdomains/${subdomain}`);
      for (let i = 0; i < 5; i++) {
        const hit = await tx.get(subRef);
        if (!hit.exists) break;
        subdomain = newSubdomain(input.businessName);
        subRef = db.doc(`storeSubdomains/${subdomain}`);
      }
      if ((await tx.get(subRef)).exists) fail('already-exists', 'error.subdomainTaken');

      const { leadId } = await upsertLead(tx, {
        name: input.ownerName,
        businessName: input.businessName,
        email,
        phone: input.phone,
        businessType: input.businessType,
        country: input.country,
        source: 'trial',
        status: 'TRIAL',
        referralCode,
        interestedFeatures: input.interestedFeatures,
      });

      const stamp = FieldValue.serverTimestamp();
      tx.set(db.doc(`users/${ownerUid}`), {
        uid: ownerUid,
        email,
        fullName: input.ownerName,
        role: 'owner',
        tenantId,
        isActive: true,
        permissions: {},
        storeName: input.businessName,
        subdomain,
        phone: input.phone,
        country: input.country ?? '',
        businessType: input.businessType,
        claimsVersion: 0,
        source: 'website',
        createdAt: stamp,
      });
      tx.set(db.doc(`stores/${tenantId}`), {
        ownerUid,
        ownerEmail: email,
        ownerName: input.ownerName,
        storeName: input.businessName,
        subdomain,
        phone: input.phone,
        businessType: input.businessType,
        country: input.country ?? '',
        primaryCurrency: input.primaryCurrency,
        source: 'website',
        referralCode,
        createdAt: stamp,
      });
      tx.set(subRef, { tenantId, createdAt: stamp });
      tx.set(db.doc(`tenants/${tenantId}`), { ownerUid, createdAt: stamp, source: 'website' });
      tx.set(db.doc(`tenants/${tenantId}/settings/main`), {
        storeName: input.businessName,
        storePhone: input.phone,
        storeAddress: '',
        receiptFooter: '',
        defaultCurrency: input.primaryCurrency.includes('LBP') && !input.primaryCurrency.includes('USD') ? 'LBP' : 'USD',
        updatedAt: stamp,
      });
      tx.set(db.doc(`tenants/${tenantId}/counters/sales`), { nextId: 1, updatedAt: stamp });
      tx.set(db.doc(`tenants/${tenantId}/counters/purchases`), { nextId: 1, updatedAt: stamp });
      tx.set(db.doc(`tenants/${tenantId}/cashbox/summary`), { usdCents: 0, lbp: 0, lastTxId: null, updatedAt: stamp });
      tx.set(db.doc(`tenants/${tenantId}/lists/categories`), { names: [] });
      tx.set(db.doc(`tenants/${tenantId}/onboarding/main`), {
        skipped: false,
        dismissedWelcome: false,
        updatedAt: stamp,
      });
      tx.set(db.doc(`subscriptions/${tenantId}`), {
        activated: false,
        lifetime: false,
        trial: true,
        status: 'pending_activation',
        plan: null,
        source: 'website',
        referralCode,
        convertedAt: null,
        trialStartedAt: null,
        trialEndsAt: null,
        startsAt: null,
        endsAt: null,
        notificationsSent: {},
        createdAt: stamp,
        updatedAt: stamp,
      });
      tx.set(emailIdx, { tenantId, uid: ownerUid, createdAt: stamp });
      tx.set(db.doc(`platformTrialIndex/uid_${ownerUid}`), { tenantId, createdAt: stamp });
      tx.set(db.doc(`platformProvisionState/${ownerUid}`), {
        status: 'ready',
        emailKey: emailKey(email),
        clientOperationId: input.clientOperationId,
        updatedAt: stamp,
      }, { merge: true });
      result = {
        ok: true,
        tenantId,
        uid: ownerUid,
        leadId,
        referralAccepted: Boolean(referralCode),
        resumable: false,
      };
      storeOp(tx, input.clientOperationId, 'trial', result);
      tx.set(db.collection('platformAudit').doc(), {
        action: 'trial_created',
        tenantId,
        uid: ownerUid,
        leadId,
        createdAt: stamp,
      });
    });
  } catch (e) {
    await releaseFailedAuthAttempt({
      uid: ownerUid,
      email,
      clientOperationId: input.clientOperationId,
      createdByThisCall,
    });
    throw e;
  }

  try {
    await syncUserClaims(ownerUid);
  } catch {
    console.error('Trial claims sync failed');
  }
  return publicTrialResult(result);
  } catch (err) {
    rethrowClientSafe(err);
  }
});

const ms = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
};

export async function runTrialLifecycle(now = Date.now()): Promise<{ expired: number; notified: number }> {
  const snap = await db.collection('subscriptions').where('trial', '==', true).get();
  let expired = 0;
  let notified = 0;
  for (const docSnap of snap.docs) {
    const sub = docSnap.data();
    const tenantId = docSnap.id;
    const ends = ms(sub.trialEndsAt) ?? ms(sub.endsAt) ?? 0;
    const starts = ms(sub.trialStartedAt) ?? ms(sub.startsAt) ?? 0;
    const sent = (sub.notificationsSent ?? {}) as Record<string, boolean>;
    const nextSent: Record<string, boolean> = { ...sent };
    const elapsedDays = starts ? Math.floor((now - starts) / DAY_MS) : 0;
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    const notes: { id: string; title: string; body: string; day: number }[] = [];

    if (ends && now >= ends) {
      const outcome = await commitTrialExpiry(tenantId, now);
      if (outcome.newlyExpired) expired += 1;
      if (outcome.noticeCreated) notified += 1;
      continue;
    } else if (sub.status === 'trial') {
      const schedule: { key: string; day: number; minElapsed: number; title: string; body: string }[] = [
        { key: 'day7', day: 7, minElapsed: 7, title: 'You’re halfway through your trial', body: 'Explore reports and customer credit while you still have time.' },
        { key: 'day12', day: 12, minElapsed: 12, title: '3 days remaining', body: 'Your ZELVERO trial ends in 3 days.' },
        { key: 'day14', day: 14, minElapsed: 14, title: 'Your trial ends tomorrow', body: 'Subscribe to keep selling with the same store data.' },
      ];
      for (const row of schedule) {
        if (elapsedDays >= row.minElapsed && !sent[row.key]) {
          notes.push({ id: row.key, day: row.day, title: row.title, body: row.body });
          nextSent[row.key] = true;
        }
      }
    }
    if (notes.length) updates.notificationsSent = nextSent;

    if (notes.length) {
      notified += notes.length;
      const batch = db.batch();
      batch.set(docSnap.ref, updates, { merge: true });
      for (const n of notes) {
        batch.set(db.doc(`tenants/${tenantId}/notifications/${n.id}`), {
          kind: `trial_${n.id}`,
          title: n.title,
          body: n.body,
          day: n.day,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }
  return { expired, notified };
}

async function commitTrialExpiry(tenantId: string, now: number): Promise<{ newlyExpired: boolean; noticeCreated: boolean }> {
  const subRef = db.doc(`subscriptions/${tenantId}`);
  const auditRef = db.doc(`platformAudit/${trialExpiryAuditId(tenantId)}`);
  const noticeRef = db.doc(`tenants/${tenantId}/notifications/day15`);
  return db.runTransaction(async (tx) => {
    const subSnap = await tx.get(subRef);
    const auditSnap = await tx.get(auditRef);
    const noticeSnap = await tx.get(noticeRef);
    if (!subSnap.exists) return { newlyExpired: false, noticeCreated: false };
    const sub = subSnap.data() ?? {};
    const ends = ms(sub.trialEndsAt) ?? ms(sub.endsAt) ?? 0;
    const plan = planTrialExpiry({
      status: typeof sub.status === 'string' ? sub.status : undefined,
      endsAtMs: ends,
      notificationsSent: (sub.notificationsSent ?? {}) as Record<string, boolean>,
      auditExists: auditSnap.exists,
      noticeExists: noticeSnap.exists,
    }, now);
    if (!plan.changed) return { newlyExpired: false, noticeCreated: false };
    if (plan.setStatus || plan.notificationsSent) {
      tx.set(subRef, {
        ...(plan.setStatus ? { status: 'trial_expired', activated: true } : {}),
        ...(plan.notificationsSent ? { notificationsSent: plan.notificationsSent } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (plan.createAudit) {
      tx.set(auditRef, {
        action: 'trial_expired',
        tenantId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (plan.createNotice) {
      tx.set(noticeRef, {
        kind: 'trial_day15',
        title: 'Your trial has ended',
        body: 'Your data is kept. The store is read-only until you subscribe.',
        day: 15,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { newlyExpired: plan.newlyExpired, noticeCreated: plan.createNotice };
  });
}

export const adminRunTrialLifecycle = onCall({ region: REGION }, async (request) => {
  requireSuperAdmin(caller(request));
  return runTrialLifecycle();
});

/**
 * Daily notice sweep. Selling already stops when the subscription is inactive or `endsAt`
 * has passed, so a missed run cannot keep an expired store writable. This restores the
 * scheduled entry point in source only; it is not deployed by this change.
 */
export const tickTrialLifecycle = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'Asia/Beirut',
    region: REGION,
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    await runTrialLifecycle(Date.now());
  },
);

export const adminListLeads = onCall({ region: REGION }, async (request) => {
  requireSuperAdmin(caller(request));
  const snap = await db.collection('platformLeads').get();
  const leads = snap.docs
    .map((d) => {
      const p = d.data();
      return {
        id: d.id,
        name: String(p.name ?? ''),
        businessName: String(p.businessName ?? ''),
        email: String(p.email ?? ''),
        phone: String(p.phone ?? ''),
        businessType: String(p.businessType ?? ''),
        source: String(p.source ?? ''),
        status: String(p.status ?? 'NEW'),
        referralCode: p.referralCode ? String(p.referralCode) : null,
        assignedTo: p.assignedTo ? String(p.assignedTo) : null,
        notes: String(p.notes ?? ''),
        interestedFeatures: Array.isArray(p.interestedFeatures) ? p.interestedFeatures.map(String) : [],
        createdAt: ms(p.createdAt),
        updatedAt: ms(p.updatedAt),
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return { leads };
});

const leadStatusSchema = z.object({
  leadId: z.string().min(1).max(80),
  status: z.enum(['NEW', 'CONTACTED', 'DEMO', 'TRIAL', 'QUOTE', 'WON', 'LOST']),
  notes: z.string().trim().max(2000).optional(),
  assignedTo: z.string().trim().max(80).optional(),
});

export const adminSetLeadStatus = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(leadStatusSchema, request.data);
  const ref = db.doc(`platformLeads/${input.leadId}`);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'error.fn.userNotFound');
  await ref.set(
    {
      status: input.status,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await writeAudit('lead_status_changed', { leadId: input.leadId, status: input.status, actorUid: c.uid });
  return { ok: true as const };
});

export const adminListTrials = onCall({ region: REGION }, async (request) => {
  requireSuperAdmin(caller(request));
  const snap = await db.collection('subscriptions').where('source', '==', 'website').get();
  const now = Date.now();
  const trials = [];
  for (const d of snap.docs) {
    const s = d.data();
    const store = (await db.doc(`stores/${d.id}`).get()).data();
    const ends = ms(s.trialEndsAt) ?? ms(s.endsAt);
    const starts = ms(s.trialStartedAt) ?? ms(s.startsAt);
    trials.push({
      tenantId: d.id,
      business: String(store?.storeName ?? ''),
      owner: String(store?.ownerName ?? ''),
      ownerEmail: String(store?.ownerEmail ?? ''),
      startDate: starts,
      endDate: ends,
      daysRemaining: ends ? Math.max(0, Math.floor((ends - now) / 86_400_000)) : 0,
      status: displayedTrialStatus({
        status: s.status ?? (s.trial ? 'trial' : 'unknown'),
        activated: s.activated === true,
        lifetime: s.lifetime === true,
        trial: s.trial === true,
        endsAtMs: ends,
      }, now),
      referralCode: s.referralCode ? String(s.referralCode) : null,
      converted: Boolean(s.convertedAt),
    });
  }
  return { trials };
});

export const adminSetSalesConfig = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(z.object({ mode: z.enum(['off', 'staging', 'on']) }), request.data);
  await db.doc('platform/salesConfig').set({ mode: input.mode, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true });
  return { ok: true as const, mode: input.mode };
});
