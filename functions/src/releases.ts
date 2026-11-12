import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import {
  CURRENT_API_COMPAT,
  CURRENT_OFFLINE_SCHEMA,
  canAssignTenants,
  canCreateVersion,
  canReleaseToEveryone,
  canTransition,
  isValidVersion,
  rollbackSafe,
  treesEligibleForDelete,
  type ReleaseStatus,
  type ReleaseType,
} from './shared/release.js';
import { caller, parse, requireSuperAdmin, trimmed } from './validate.js';

const releaseRef = (version: string) => db.doc(`platformReleases/${version}`);
const manifestRef = db.doc('platformReleaseManifest/current');
const assignmentRef = (tenantId: string) => db.doc(`platformReleaseAssignments/${tenantId}`);

const semver = z.string().trim().refine(isValidVersion, 'error.release.invalidVersion');

async function audit(input: {
  actorUid: string;
  action: string;
  version: string;
  buildId?: string;
  target?: unknown;
  previousVersion?: string | null;
  meta?: Record<string, unknown>;
}) {
  await db.collection('platformReleaseAudit').add({
    ...input,
    at: FieldValue.serverTimestamp(),
    atMs: Date.now(),
  });
}

async function readManifest() {
  const snap = await manifestRef.get();
  const d = snap.data() ?? {};
  return {
    productionVersion: typeof d.productionVersion === 'string' ? d.productionVersion : null,
    previousProductionVersion: typeof d.previousProductionVersion === 'string' ? d.previousProductionVersion : null,
    stagingVersion: typeof d.stagingVersion === 'string' ? d.stagingVersion : null,
    minSupportedVersion: typeof d.minSupportedVersion === 'string' ? d.minSupportedVersion : null,
    paused: d.paused === true,
    updatedAt: typeof d.updatedAtMs === 'number' ? d.updatedAtMs : null,
  };
}

function publicRelease(d: DocumentData, id: string) {
  return {
    version: id,
    buildId: String(d.buildId ?? ''),
    gitSha: String(d.gitSha ?? ''),
    title: String(d.title ?? ''),
    notes: String(d.notes ?? ''),
    releaseType: d.releaseType as ReleaseType,
    status: d.status as ReleaseStatus,
    targetType: d.targetType === 'everyone' ? 'everyone' : d.targetType === 'tenants' ? 'tenants' : 'none',
    targetTenantIds: Array.isArray(d.targetTenantIds) ? d.targetTenantIds.map(String) : [],
    apiCompatibilityVersion: Number(d.apiCompatibilityVersion ?? CURRENT_API_COMPAT),
    offlineSchemaVersion: Number(d.offlineSchemaVersion ?? CURRENT_OFFLINE_SCHEMA),
    minSupportedVersion: typeof d.minSupportedVersion === 'string' ? d.minSupportedVersion : null,
    requiresReload: d.requiresReload !== false,
    requiresMigration: d.requiresMigration === true,
    migrationVersion: typeof d.migrationVersion === 'string' ? d.migrationVersion : null,
    rollbackVersion: typeof d.rollbackVersion === 'string' ? d.rollbackVersion : null,
    rollbackSafe: d.rollbackSafe === true,
    emergency: d.emergency === true,
    createdAt: typeof d.createdAtMs === 'number' ? d.createdAtMs : null,
    createdBy: String(d.createdBy ?? ''),
    releasedAt: typeof d.releasedAtMs === 'number' ? d.releasedAtMs : null,
    releasedBy: typeof d.releasedBy === 'string' ? d.releasedBy : null,
  };
}

export const createRelease = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(
    z.object({
      version: semver,
      title: trimmed(120),
      notes: z.string().trim().max(4000).default(''),
      releaseType: z.enum(['patch', 'minor', 'major']),
      buildId: trimmed(80),
      gitSha: z.string().trim().max(64).default(''),
      requiresMigration: z.boolean().default(false),
      migrationVersion: z.string().trim().max(40).nullable().optional(),
    }),
    request.data,
  );
  const manifest = await readManifest();
  if (!canCreateVersion(input.version, manifest.productionVersion)) fail('failed-precondition', 'error.release.invalidVersion');
  const ref = releaseRef(input.version);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) fail('already-exists', 'error.release.exists');
    tx.set(ref, {
      version: input.version,
      title: input.title,
      notes: input.notes,
      releaseType: input.releaseType,
      buildId: input.buildId,
      gitSha: input.gitSha,
      status: 'draft',
      targetType: 'none',
      targetTenantIds: [],
      apiCompatibilityVersion: CURRENT_API_COMPAT,
      offlineSchemaVersion: CURRENT_OFFLINE_SCHEMA,
      requiresReload: true,
      requiresMigration: input.requiresMigration,
      migrationVersion: input.migrationVersion ?? null,
      rollbackVersion: null,
      rollbackSafe: true,
      emergency: false,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      createdBy: c.uid,
    });
  });
  await audit({ actorUid: c.uid, action: 'created', version: input.version, buildId: input.buildId });
  return { ok: true as const };
});

export const setReleaseStatus = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(
    z.object({
      version: semver,
      status: z.enum(['testing', 'ready', 'draft']),
    }),
    request.data,
  );
  const ref = releaseRef(input.version);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'error.release.missing');
  const current = snap.get('status') as ReleaseStatus;
  if (!canTransition(current, input.status)) fail('failed-precondition', 'error.release.invalidStatus');
  const patch: Record<string, unknown> = { status: input.status, updatedAtMs: Date.now() };
  if (input.status === 'testing') {
    await manifestRef.set({ stagingVersion: input.version, updatedAtMs: Date.now(), paused: false }, { merge: true });
  }
  await ref.update(patch);
  await audit({ actorUid: c.uid, action: `status:${input.status}`, version: input.version, previousVersion: current });
  return { ok: true as const };
});

export const assignReleaseTenants = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(
    z.object({
      version: semver,
      tenantIds: z.array(z.string().trim().min(1).max(128)).min(1).max(500),
      confirm: trimmed(80),
    }),
    request.data,
  );
  if (input.confirm !== `RELEASE ${input.version} TO SELECTED STORES`) fail('failed-precondition', 'error.fn.confirmMismatch');
  const ref = releaseRef(input.version);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'error.release.missing');
  const status = snap.get('status') as ReleaseStatus;
  if (!canAssignTenants(status)) fail('failed-precondition', 'error.release.invalidStatus');
  const ids = [...new Set(input.tenantIds)];
  const batch = db.batch();
  for (const tenantId of ids) {
    batch.set(assignmentRef(tenantId), {
      tenantId,
      assignedVersion: input.version,
      assignedBuildId: String(snap.get('buildId') ?? ''),
      sourceRelease: input.version,
      updatedAtMs: Date.now(),
      updatedBy: c.uid,
    });
  }
  batch.update(ref, { status: 'pilot', targetType: 'tenants', targetTenantIds: FieldValue.arrayUnion(...ids), updatedAtMs: Date.now() });
  await batch.commit();
  await audit({ actorUid: c.uid, action: 'published', version: input.version, target: { tenantIds: ids }, buildId: String(snap.get('buildId') ?? '') });
  return { ok: true as const, tenantCount: ids.length };
});

export const releaseToEveryone = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(
    z.object({
      version: semver,
      confirm: trimmed(120),
      emergency: z.boolean().default(false),
      emergencyReason: z.string().trim().max(300).optional(),
    }),
    request.data,
  );
  const expected = input.emergency ? `EMERGENCY RELEASE ${input.version} TO EVERYONE` : `RELEASE ${input.version} TO EVERYONE`;
  if (input.confirm !== expected) fail('failed-precondition', 'error.fn.confirmMismatch');
  if (input.emergency && !input.emergencyReason) fail('invalid-argument', 'error.release.emergencyReason');
  const ref = releaseRef(input.version);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'error.release.missing');
  const status = snap.get('status') as ReleaseStatus;
  if (!canReleaseToEveryone(status, input.emergency)) fail('failed-precondition', 'error.release.invalidStatus');
  const manifest = await readManifest();
  await db.runTransaction(async (tx) => {
    tx.update(ref, {
      status: 'released',
      targetType: 'everyone',
      emergency: input.emergency,
      emergencyReason: input.emergencyReason ?? null,
      releasedAt: FieldValue.serverTimestamp(),
      releasedAtMs: Date.now(),
      releasedBy: c.uid,
      updatedAtMs: Date.now(),
    });
    tx.set(
      manifestRef,
      {
        previousProductionVersion: manifest.productionVersion,
        productionVersion: input.version,
        paused: false,
        updatedAtMs: Date.now(),
      },
      { merge: true },
    );
  });
  await audit({
    actorUid: c.uid,
    action: input.emergency ? 'emergency-everyone' : 'everyone',
    version: input.version,
    previousVersion: manifest.productionVersion,
    buildId: String(snap.get('buildId') ?? ''),
    meta: input.emergency ? { reason: input.emergencyReason } : {},
  });
  return { ok: true as const };
});

export const pauseRelease = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const { version } = parse(z.object({ version: semver }), request.data);
  const ref = releaseRef(version);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'error.release.missing');
  const status = snap.get('status') as ReleaseStatus;
  if (!canTransition(status, 'paused')) fail('failed-precondition', 'error.release.invalidStatus');
  await ref.update({ status: 'paused', updatedAtMs: Date.now() });
  await manifestRef.set({ paused: true, updatedAtMs: Date.now() }, { merge: true });
  await audit({ actorUid: c.uid, action: 'paused', version, previousVersion: status });
  return { ok: true as const };
});

export const rollbackRelease = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(z.object({ fromVersion: semver, toVersion: semver, confirm: trimmed(120) }), request.data);
  if (input.confirm !== `ROLLBACK ${input.fromVersion} TO ${input.toVersion}`) fail('failed-precondition', 'error.fn.confirmMismatch');
  const [fromSnap, toSnap] = await Promise.all([releaseRef(input.fromVersion).get(), releaseRef(input.toVersion).get()]);
  if (!fromSnap.exists || !toSnap.exists) fail('not-found', 'error.release.missing');
  const safe = rollbackSafe({
    toVersion: input.toVersion,
    fromVersion: input.fromVersion,
    toApi: Number(toSnap.get('apiCompatibilityVersion') ?? CURRENT_API_COMPAT),
    liveApiMin: CURRENT_API_COMPAT,
    toOfflineSchema: Number(toSnap.get('offlineSchemaVersion') ?? CURRENT_OFFLINE_SCHEMA),
    liveOfflineSchema: CURRENT_OFFLINE_SCHEMA,
    fromRequiresMigration: fromSnap.get('requiresMigration') === true,
  });
  if (!safe) fail('failed-precondition', 'error.release.rollbackUnsafe');
  const manifest = await readManifest();
  await db.runTransaction(async (tx) => {
    tx.update(releaseRef(input.fromVersion), { status: 'rolled_back', rollbackVersion: input.toVersion, updatedAtMs: Date.now() });
    tx.set(
      manifestRef,
      {
        productionVersion: input.toVersion,
        previousProductionVersion: input.fromVersion,
        paused: false,
        updatedAtMs: Date.now(),
      },
      { merge: true },
    );
  });
  await audit({ actorUid: c.uid, action: 'rolled_back', version: input.fromVersion, previousVersion: manifest.productionVersion, meta: { toVersion: input.toVersion } });
  return { ok: true as const, rollbackSafe: true };
});

export const setMinSupportedVersion = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const { version } = parse(z.object({ version: semver }), request.data);
  await manifestRef.set({ minSupportedVersion: version, updatedAtMs: Date.now() }, { merge: true });
  await audit({ actorUid: c.uid, action: 'min-supported', version });
  return { ok: true as const };
});

export const getMyReleaseAssignment = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  const manifest = await readManifest();
  if (!c.tenantId) {
    return {
      assignedVersion: null,
      productionVersion: manifest.productionVersion,
      stagingVersion: manifest.stagingVersion,
      minSupportedVersion: manifest.minSupportedVersion,
      paused: manifest.paused,
      title: null,
      notes: null,
      buildId: null,
    };
  }
  const assignment = await assignmentRef(c.tenantId).get();
  const assignedVersion = assignment.exists ? String(assignment.get('assignedVersion') ?? '') || null : null;
  const effective = assignedVersion || (!manifest.paused ? manifest.productionVersion : null);
  let title = null;
  let notes = null;
  let buildId = null;
  let status = null;
  if (effective) {
    const rel = await releaseRef(effective).get();
    if (rel.exists) {
      title = String(rel.get('title') ?? '');
      notes = String(rel.get('notes') ?? '');
      buildId = String(rel.get('buildId') ?? '');
      status = String(rel.get('status') ?? '');
    }
  }
  return {
    assignedVersion: effective,
    productionVersion: manifest.productionVersion,
    stagingVersion: manifest.stagingVersion,
    minSupportedVersion: manifest.minSupportedVersion,
    paused: manifest.paused,
    title,
    notes,
    buildId,
    status,
  };
});

export const listReleases = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const [rels, manifest, auditSnap] = await Promise.all([
    db.collection('platformReleases').orderBy('createdAtMs', 'desc').limit(100).get(),
    readManifest(),
    db.collection('platformReleaseAudit').orderBy('atMs', 'desc').limit(50).get(),
  ]);
  return {
    manifest,
    releases: rels.docs.map((d) => publicRelease(d.data(), d.id)),
    audit: auditSnap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, action: x.action, version: x.version, at: x.atMs ?? null, actorUid: x.actorUid, target: x.target ?? null };
    }),
  };
});

export const checkReleaseTreeRetention = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(z.object({ trees: z.array(z.string().trim().min(1).max(40)).max(50) }), request.data);
  const [manifest, rels, assigns] = await Promise.all([
    readManifest(),
    db.collection('platformReleases').get(),
    db.collection('platformReleaseAssignments').get(),
  ]);
  const assignedVersions = assigns.docs.map((d) => String(d.get('assignedVersion') ?? '')).filter(Boolean);
  const rollbackVersions = rels.docs.map((d) => String(d.get('rollbackVersion') ?? '')).filter(Boolean);
  const deletable = treesEligibleForDelete({
    trees: input.trees,
    assignedVersions,
    productionVersion: manifest.productionVersion,
    previousProductionVersion: manifest.previousProductionVersion,
    minSupportedVersion: manifest.minSupportedVersion,
    rollbackVersions,
    stagingVersion: manifest.stagingVersion,
  });
  return { deletable, kept: input.trees.filter((t) => !deletable.includes(t)) };
});
