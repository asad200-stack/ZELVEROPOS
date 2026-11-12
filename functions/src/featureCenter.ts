import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import {
  FEATURE_REGISTRY,
  PUBLICATION_STATES,
  RESERVED_TEST_TENANT,
  customerUpdate,
  effectiveRecord,
  emptyFeatureRecord,
  isEligibleCustomer,
  type FeatureDefinition,
  planActivation,
  planGrantPaid,
  planMarkReady,
  planPause,
  planPublish,
  planRollback,
  publicationBlockers,
  type CustomerAccount,
  type EntitlementRecord,
  type FeatureRecord,
} from './shared/featureRelease.js';
import { EMULATOR_VERIFY_FEATURES } from './emulatorFeatureFixtures.js';
import { caller, parse, requireOwner, requireSuperAdmin, trimmed } from './validate.js';

function registry(): FeatureDefinition[] {
  return process.env.FUNCTIONS_EMULATOR === 'true' ? [...FEATURE_REGISTRY, ...EMULATOR_VERIFY_FEATURES] : FEATURE_REGISTRY;
}

function findFeature(id: string): FeatureDefinition | null {
  return registry().find((feature) => feature.id === id) ?? null;
}

const featureRef = (id: string) => db.doc(`platformFeatures/${id}`);
const controlRef = db.doc('platformFeatureControl/global');
const entitlementRef = (tenantId: string, featureId: string) => db.doc(`platformFeatureEntitlements/${tenantId}__${featureId}`);

const featureId = trimmed(40).regex(/^[a-z][a-z0-9_]{1,40}$/);

function body(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const copy = { ...(data as Record<string, unknown>) };
  delete copy.clientApiVersion;
  delete copy.clientReleaseVersion;
  return copy;
}

async function audit(action: string, actorUid: string, featureId: string, meta: Record<string, unknown>) {
  await db.collection('platformFeatureAudit').add({
    action,
    actorUid,
    featureId,
    meta,
    at: FieldValue.serverTimestamp(),
    atMs: Date.now(),
  });
}

async function killed(): Promise<boolean> {
  const snap = await controlRef.get();
  return snap.get('killed') === true;
}

function recordFrom(data: DocumentData | undefined, feature: FeatureDefinition): FeatureRecord {
  if (!data) return emptyFeatureRecord(feature);
  const audience = data.audience as { allEligible?: boolean; tenantIds?: string[] } | undefined;
  return effectiveRecord(feature, {
    version: String(data.version ?? ''),
    publication: PUBLICATION_STATES.includes(data.publication) ? data.publication : 'internal_testing',
    audience: {
      allEligible: audience?.allEligible === true,
      tenantIds: Array.isArray(audience?.tenantIds) ? audience.tenantIds.map(String) : [],
    },
    receipt: typeof data.receipt === 'string' ? data.receipt : null,
    testingStatus: data.testingStatus === 'passed' || data.testingStatus === 'in_testing' ? data.testingStatus : 'untested',
    history: Array.isArray(data.history) ? data.history : [],
  });
}

function entitlementFrom(data: DocumentData | undefined): EntitlementRecord | null {
  if (!data) return null;
  return {
    tenantId: String(data.tenantId ?? ''),
    featureId: String(data.featureId ?? ''),
    version: String(data.version ?? ''),
    pricing: data.pricing === 'paid' ? 'paid' : 'free',
    priceUsdCents: typeof data.priceUsdCents === 'number' ? data.priceUsdCents : null,
    status: data.status,
    paidGrant: data.paidGrant === true,
  };
}

async function accountsFor(tenantIds: string[] | null, now: number): Promise<CustomerAccount[]> {
  if (tenantIds && tenantIds.length === 0) return [];
  const owners = tenantIds
    ? await db.getAll(...tenantIds.map((id) => db.doc(`users/${id}`)))
    : (await db.collection('users').where('role', '==', 'owner').get()).docs;
  const rows: CustomerAccount[] = [];
  for (const group of chunk(owners, 300)) {
    const subs = await db.getAll(
      ...group.map((doc) => db.doc(`subscriptions/${String(doc.get('tenantId') ?? doc.id)}`)),
    );
    group.forEach((doc, index) => {
      const sub = subs[index];
      const tenantId = String(doc.get('tenantId') ?? doc.id);
      if (!doc.exists || tenantId === RESERVED_TEST_TENANT) return;
      const endsAt = sub?.get('endsAt');
      rows.push({
        tenantId,
        storeName: String(doc.get('storeName') ?? ''),
        internalDemo: doc.get('internalDemo') === true || sub?.get('internalDemo') === true,
        activated: sub?.get('activated') === true,
        lifetime: sub?.get('lifetime') === true,
        endsAt: typeof endsAt?.toMillis === 'function' ? endsAt.toMillis() : null,
      });
    });
  }
  return tenantIds ? rows.filter((row) => isEligibleCustomer(row, now) || tenantIds.includes(row.tenantId)) : rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function callerIsInternalDemo(uid: string, tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;
  const [user, sub] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`subscriptions/${tenantId}`).get()]);
  return user.get('internalDemo') === true || sub.get('internalDemo') === true;
}

export const listFeatureCatalog = onCall({ region: REGION }, async (request) => {
  requireSuperAdmin(caller(request));
  const [snaps, control] = await Promise.all([
    db.getAll(...registry().map((feature) => featureRef(feature.id))),
    controlRef.get(),
  ]);
  const features = registry().map((feature, index) => {
    const record = recordFrom(snaps[index]?.data(), feature);
    return {
      ...publicFeature(feature),
      publication: record.publication,
      testingStatus: record.testingStatus,
      audienceCount: record.audience.tenantIds.length,
      allEligible: record.audience.allEligible,
      history: record.history,
      blockers: publicationBlockers(feature, control.get('killed') === true),
    };
  });
  const entitlements = await db.collection('platformFeatureEntitlements').limit(500).get();
  const delivery = registry().map((feature) => {
    const rows = entitlements.docs.filter((doc) => doc.get('featureId') === feature.id);
    return {
      featureId: feature.id,
      notified: rows.filter((doc) => doc.get('status') === 'notified').length,
      active: rows.filter((doc) => doc.get('status') === 'active').length,
      paused: rows.filter((doc) => doc.get('status') === 'paused').length,
      revoked: rows.filter((doc) => doc.get('status') === 'revoked').length,
    };
  });
  return { killed: control.get('killed') === true, features, delivery };
});

export const markFeatureReady = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(z.object({ featureId }).strict(), body(request.data));
  const feature = findFeature(input.featureId);
  if (!feature) fail('not-found', 'feature.missing');
  const now = Date.now();
  const plan = planMarkReady(feature, recordFrom((await featureRef(feature.id).get()).data(), feature), await killed(), actor.uid, now);
  if (!plan.ok) fail('failed-precondition', plan.reason);
  if (!plan.duplicate) await featureRef(feature.id).set(stored(plan.record), { merge: true });
  await audit('ready', actor.uid, feature.id, { duplicate: plan.duplicate });
  return { ok: true as const, duplicate: plan.duplicate };
});

export const publishFeature = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(
    z
      .object({
        featureId,
        confirmPublication: z.literal(true),
        confirmAllEligible: z.boolean(),
        allEligible: z.boolean(),
        tenantIds: z.array(trimmed(128)).max(200),
      })
      .strict(),
    body(request.data),
  );
  const feature = findFeature(input.featureId);
  if (!feature) fail('not-found', 'feature.missing');
  const now = Date.now();
  const accounts = await accountsFor(input.allEligible ? null : input.tenantIds, now);
  const plan = planPublish({
    definition: feature,
    record: recordFrom((await featureRef(feature.id).get()).data(), feature),
    killed: await killed(),
    confirmPublication: input.confirmPublication,
    confirmAllEligible: input.confirmAllEligible,
    allEligible: input.allEligible,
    tenantIds: input.tenantIds,
    accounts,
    now,
    actorUid: actor.uid,
  });
  if (!plan.ok) fail('failed-precondition', plan.reason);
  if (!plan.duplicate) {
    const batch = db.batch();
    batch.set(featureRef(feature.id), stored(plan.record), { merge: true });
    for (const entitlement of plan.entitlements) {
      batch.set(entitlementRef(entitlement.tenantId, feature.id), { ...entitlement, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
  await audit('published', actor.uid, feature.id, {
    duplicate: plan.duplicate,
    tenants: plan.duplicate ? 0 : plan.entitlements.length,
    allEligible: input.allEligible,
  });
  return { ok: true as const, duplicate: plan.duplicate, tenants: plan.duplicate ? 0 : plan.entitlements.length };
});

export const pauseFeature = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(z.object({ featureId, confirm: z.literal(true) }).strict(), body(request.data));
  return changeAudience(actor.uid, input.featureId, 'pause');
});

export const rollbackFeature = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(z.object({ featureId, confirm: z.literal(true) }).strict(), body(request.data));
  return changeAudience(actor.uid, input.featureId, 'rollback');
});

async function changeAudience(actorUid: string, id: string, action: 'pause' | 'rollback') {
  const feature = findFeature(id);
  if (!feature) fail('not-found', 'feature.missing');
  const now = Date.now();
  const current = recordFrom((await featureRef(id).get()).data(), feature);
  const plan = action === 'pause' ? planPause(current, actorUid, now) : planRollback(current, actorUid, now);
  if (!plan.ok) fail('failed-precondition', plan.reason);
  const nextStatus = action === 'pause' ? 'paused' : 'revoked';
  const existing = await db.collection('platformFeatureEntitlements').where('featureId', '==', id).limit(500).get();
  const batch = db.batch();
  batch.set(featureRef(id), stored(plan.record), { merge: true });
  for (const doc of existing.docs) {
    if (doc.get('status') === 'revoked') continue;
    batch.set(doc.ref, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  await audit(action, actorUid, id, { entitlements: existing.size });
  return { ok: true as const };
}

export const grantFeaturePurchase = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(z.object({ featureId, tenantId: trimmed(128), confirm: z.literal(true) }).strict(), body(request.data));
  if (input.tenantId === RESERVED_TEST_TENANT) fail('permission-denied', 'feature.blocked.testTenant');
  const feature = findFeature(input.featureId);
  if (!feature) fail('not-found', 'feature.missing');
  const [featureSnap, entitlementSnap, user] = await Promise.all([
    featureRef(feature.id).get(),
    entitlementRef(input.tenantId, feature.id).get(),
    db.doc(`users/${input.tenantId}`).get(),
  ]);
  if (user.get('internalDemo') === true) fail('permission-denied', 'feature.blocked.customer');
  const plan = planGrantPaid({
    definition: feature,
    record: recordFrom(featureSnap.data(), feature),
    entitlement: entitlementFrom(entitlementSnap.data()),
    killed: await killed(),
  });
  if (!plan.ok) fail('failed-precondition', plan.reason);
  await entitlementRef(input.tenantId, feature.id).set(
    { ...plan.entitlement, grantedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await audit('grant_paid', actor.uid, feature.id, { tenantId: input.tenantId });
  return { ok: true as const };
});

export const setFeatureKillSwitch = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(z.object({ killed: z.boolean(), confirm: z.literal(true) }).strict(), body(request.data));
  await controlRef.set({ killed: input.killed, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await audit(input.killed ? 'kill' : 'restore', actor.uid, '*', {});
  return { ok: true as const, killed: input.killed };
});

export const recordFeaturePreview = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  requireSuperAdmin(actor);
  const input = parse(z.object({ featureId }).strict(), body(request.data));
  const feature = findFeature(input.featureId);
  if (!feature) fail('not-found', 'feature.missing');
  if (!(await callerIsInternalDemo(actor.uid, actor.tenantId)) || actor.tenantId !== actor.uid) {
    fail('failed-precondition', 'feature.blocked.testStore');
  }
  await db.doc(`platformFeaturePreview/${actor.uid}__${feature.id}`).set({
    featureId: feature.id,
    version: feature.version,
    actorUid: actor.uid,
    tenantId: actor.tenantId,
    at: FieldValue.serverTimestamp(),
  });
  await audit('preview', actor.uid, feature.id, {});
  return { ok: true as const, path: '/dashboard' };
});

export const listMyFeatureUpdates = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  if (!actor.tenantId || !actor.active || (actor.role !== 'owner' && actor.role !== 'subUser')) {
    fail('permission-denied', 'error.fn.notAllowed');
  }
  if (actor.tenantId === RESERVED_TEST_TENANT || (await callerIsInternalDemo(actor.uid, actor.tenantId))) {
    return { updates: [] };
  }
  const [rows, control, featureSnaps] = await Promise.all([
    db.collection('platformFeatureEntitlements').where('tenantId', '==', actor.tenantId).limit(50).get(),
    controlRef.get(),
    db.getAll(...registry().map((feature) => featureRef(feature.id))),
  ]);
  const isKilled = control.get('killed') === true;
  const updates = rows.docs.flatMap((doc) => {
    const entitlement = entitlementFrom(doc.data());
    const feature = entitlement ? findFeature(entitlement.featureId) : null;
    if (!entitlement || !feature) return [];
    const stored = featureSnaps[registry().findIndex((item) => item.id === feature.id)]?.data();
    const update = customerUpdate({ definition: feature, record: recordFrom(stored, feature), entitlement, killed: isKilled });
    return update ? [update] : [];
  });
  return { updates };
});

export const activateMyFeature = onCall({ region: REGION }, async (request) => {
  const actor = caller(request);
  const tenantId = requireOwner(actor);
  const input = parse(z.object({ featureId }).strict(), body(request.data));
  if (tenantId === RESERVED_TEST_TENANT || (await callerIsInternalDemo(actor.uid, tenantId))) {
    fail('permission-denied', 'feature.blocked.customer');
  }
  const feature = findFeature(input.featureId);
  if (!feature) fail('not-found', 'feature.missing');
  const [featureSnap, entitlementSnap, isKilled] = await Promise.all([
    featureRef(feature.id).get(),
    entitlementRef(tenantId, feature.id).get(),
    killed(),
  ]);
  const plan = planActivation({
    definition: feature,
    record: recordFrom(featureSnap.data(), feature),
    entitlement: entitlementFrom(entitlementSnap.data()),
    killed: isKilled,
  });
  if (!plan.ok) fail('failed-precondition', plan.reason);
  if (!plan.duplicate) {
    await entitlementRef(tenantId, feature.id).set(
      {
        ...plan.entitlement,
        installation: 'server_activation',
        activatedAt: FieldValue.serverTimestamp(),
        activatedBy: actor.uid,
      },
      { merge: true },
    );
  }
  await audit('activated', actor.uid, feature.id, { duplicate: plan.duplicate, tenantId });
  return {
    ok: true as const,
    duplicate: plan.duplicate,
    reloadRequired: feature.reloadRequired,
    stages: ['checked', 'entitled', 'active'] as const,
  };
});

function publicFeature(feature: FeatureDefinition) {
  return {
    id: feature.id,
    title: feature.title,
    description: feature.description,
    version: feature.version,
    icon: feature.icon,
    screenshots: feature.screenshots,
    category: feature.category,
    classification: feature.classification,
    pricing: feature.pricing,
    priceUsdCents: feature.priceUsdCents,
    capabilities: feature.capabilities,
    requirements: feature.requirements,
    compatibility: feature.compatibility,
    customerExecution: feature.customerExecution,
    navPath: feature.navPath,
    navLabel: feature.navLabel,
    activation: feature.activation,
    reloadRequired: feature.reloadRequired,
  };
}

function stored(record: FeatureRecord) {
  return { ...record, updatedAt: FieldValue.serverTimestamp() };
}
