import { doc, setDoc, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, clearAuth, clearFirestore, createEnv, createUser, DAY, functionsTriggerUrl, PROJECT_ID, readDoc, readWhere } from './helpers';

const ACTIVE = 'life-active';
const HALFWAY = 'life-halfway';
const EXPIRED = 'life-expired';
const ALREADY = 'life-already';
const INACTIVE = 'life-inactive';

let env: RulesTestEnvironment;
let expiredToken: string;
let inactiveToken: string;
let adminToken: string;
const endsAt: Record<string, number> = {};

function millis(value: unknown): number {
  const stamp = value as { toMillis?: () => number } | null | undefined;
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
}

function scheduleEvent(): string {
  const published = new Date().toISOString();
  return JSON.stringify({
    specversion: '1.0',
    id: `lifecycle-${Date.now()}`,
    time: published,
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    source: `//pubsub.googleapis.com/projects/${PROJECT_ID}/topics/firebase-schedule-tickTrialLifecycle`,
    data: {
      message: {
        data: Buffer.from('{}').toString('base64'),
        messageId: `lifecycle-${Date.now()}`,
        publishTime: published,
      },
    },
  });
}

async function postSchedule(trigger: string): Promise<Response> {
  return fetch(functionsTriggerUrl(trigger), {
    method: 'POST',
    headers: { 'Content-Type': 'application/cloudevents+json' },
    body: scheduleEvent(),
  });
}

/** Invokes tickTrialLifecycle, the scheduled wrapper, not the admin helper. */
async function tickSchedule(): Promise<string> {
  if (!process.env.PUBSUB_EMULATOR_HOST) throw new Error('Pub/Sub emulator is not running');
  const probe = await postSchedule('tickTrialLifecycle');
  if (probe.ok) return 'tickTrialLifecycle';
  const text = await probe.text();
  const trigger = text.match(/europe-west1-tickTrialLifecycle-\d+/)?.[0];
  if (!trigger || trigger.includes('adminRunTrialLifecycle')) throw new Error(text);
  const sent = await postSchedule(trigger);
  if (!sent.ok) throw new Error(`scheduled tick failed: ${sent.status} ${await sent.text()}`);
  return trigger;
}

async function waitFor(label: string, ready: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function checkout(token: string, saleId: string) {
  return call(token, 'posCheckout', {
    saleId,
    kind: 'cash',
    currency: 'USD',
    rate: 89_500,
    customerId: null,
    debtLineUsdCents: null,
    lines: [],
    expectedTotalUsdCents: 0,
    cash: { receivedUsdCents: 0, receivedLbp: 0 },
  });
}

beforeAll(async () => {
  env = await createEnv();
  await clearFirestore(env);
  await clearAuth();
  const now = Date.now();
  endsAt[ACTIVE] = now + 14 * DAY;
  endsAt[HALFWAY] = now + 7 * DAY;
  endsAt[EXPIRED] = now - 60_000;
  endsAt[ALREADY] = now - 2 * DAY;
  await asAdmin(env, async (fs) => {
    const trial = (id: string, extra: Record<string, unknown>) => setDoc(doc(fs, `subscriptions/${id}`), {
      activated: true,
      lifetime: false,
      trial: true,
      plan: null,
      source: 'website',
      ...extra,
    });
    await trial(ACTIVE, {
      status: 'trial',
      startsAt: Timestamp.fromMillis(now - DAY),
      endsAt: Timestamp.fromMillis(endsAt[ACTIVE]!),
      trialStartedAt: Timestamp.fromMillis(now - DAY),
      trialEndsAt: Timestamp.fromMillis(endsAt[ACTIVE]!),
      notificationsSent: {},
    });
    await trial(HALFWAY, {
      status: 'trial',
      startsAt: Timestamp.fromMillis(now - 8 * DAY),
      endsAt: Timestamp.fromMillis(endsAt[HALFWAY]!),
      trialStartedAt: Timestamp.fromMillis(now - 8 * DAY),
      trialEndsAt: Timestamp.fromMillis(endsAt[HALFWAY]!),
      notificationsSent: {},
    });
    await trial(EXPIRED, {
      status: 'trial',
      startsAt: Timestamp.fromMillis(now - 16 * DAY),
      endsAt: Timestamp.fromMillis(endsAt[EXPIRED]!),
      trialStartedAt: Timestamp.fromMillis(now - 16 * DAY),
      trialEndsAt: Timestamp.fromMillis(endsAt[EXPIRED]!),
      notificationsSent: { day0: true },
    });
    await trial(ALREADY, {
      status: 'trial_expired',
      startsAt: Timestamp.fromMillis(now - 20 * DAY),
      endsAt: Timestamp.fromMillis(endsAt[ALREADY]!),
      trialStartedAt: Timestamp.fromMillis(now - 20 * DAY),
      trialEndsAt: Timestamp.fromMillis(endsAt[ALREADY]!),
      notificationsSent: { day15: true },
    });
    await setDoc(doc(fs, `tenants/${ALREADY}/notifications/day15`), {
      kind: 'trial_day15',
      title: 'Kept notice',
      body: 'Do not replace this notice.',
      day: 15,
      read: false,
    });
    await setDoc(doc(fs, `subscriptions/${INACTIVE}`), {
      activated: false,
      lifetime: false,
      trial: true,
      status: 'pending_activation',
      startsAt: null,
      endsAt: null,
      notificationsSent: {},
    });
    for (const id of [EXPIRED, INACTIVE]) {
      await setDoc(doc(fs, `users/${id}-owner`), {
        uid: `${id}-owner`,
        role: 'owner',
        tenantId: id,
        isActive: true,
        fullName: id,
        permissions: {},
      });
    }
  });
  expiredToken = await createUser({ uid: `${EXPIRED}-owner`, tenantId: EXPIRED, role: 'owner' });
  inactiveToken = await createUser({ uid: `${INACTIVE}-owner`, tenantId: INACTIVE, role: 'owner' });
  adminToken = await createUser({ uid: 'life-admin', tenantId: ACTIVE, role: 'owner', superAdmin: true });
});

afterAll(async () => {
  await env?.cleanup();
});

describe('scheduled trial lifecycle', () => {
  it('blocks inactive and expired writes before the sweep', async () => {
    const expired = await checkout(expiredToken, 'life-expired-before');
    const inactive = await checkout(inactiveToken, 'life-inactive-before');
    expect(expired.error?.key).toBe('error.fn.subscriptionInactive');
    expect(inactive.error?.key).toBe('error.fn.subscriptionInactive');
    const stored = await readDoc(env, `subscriptions/${EXPIRED}`);
    expect(stored?.status).toBe('trial');
    expect(stored?.activated).toBe(true);
    const listed = await call<{ trials: { tenantId: string; status: string }[] }>(adminToken, 'adminListTrials', {});
    expect(listed.result?.trials.find((row) => row.tenantId === EXPIRED)?.status).toBe('trial_expired');
  });

  it('expires only the finished trial and keeps notices idempotent', async () => {
    const trigger = await tickSchedule();
    expect(trigger).toMatch(/tickTrialLifecycle/);
    expect(trigger).not.toContain('adminRun');
    await waitFor('first lifecycle pass', async () => {
      const expired = await readDoc(env, `subscriptions/${EXPIRED}`);
      const notice = await readDoc(env, `tenants/${HALFWAY}/notifications/day7`);
      return expired?.status === 'trial_expired' && notice?.day === 7;
    });

    const active = await readDoc(env, `subscriptions/${ACTIVE}`);
    expect(active?.status).toBe('trial');
    expect(active?.activated).toBe(true);
    expect(millis(active?.endsAt)).toBe(endsAt[ACTIVE]);
    expect(await readDoc(env, `tenants/${ACTIVE}/notifications/day7`)).toBeUndefined();
    expect(await readDoc(env, `tenants/${ACTIVE}/notifications/day15`)).toBeUndefined();

    const halfway = await readDoc(env, `subscriptions/${HALFWAY}`);
    expect(halfway?.status).toBe('trial');
    expect(halfway?.activated).toBe(true);
    expect(millis(halfway?.endsAt)).toBe(endsAt[HALFWAY]);
    expect(await readDoc(env, `tenants/${HALFWAY}/notifications/day7`)).toMatchObject({ day: 7 });
    expect(await readDoc(env, `tenants/${HALFWAY}/notifications/day12`)).toBeUndefined();

    const expired = await readDoc(env, `subscriptions/${EXPIRED}`);
    expect(expired?.status).toBe('trial_expired');
    expect(millis(expired?.endsAt)).toBe(endsAt[EXPIRED]);
    expect((expired?.notificationsSent as { day15?: boolean })?.day15).toBe(true);
    const expiredNotice = await readDoc(env, `tenants/${EXPIRED}/notifications/day15`);
    expect(expiredNotice).toMatchObject({ day: 15, title: 'Your trial has ended' });

    expect(await readDoc(env, `tenants/${ALREADY}/notifications/day15`)).toMatchObject({
      title: 'Kept notice',
      body: 'Do not replace this notice.',
    });
    expect((await readDoc(env, `subscriptions/${INACTIVE}`))?.status).toBe('pending_activation');
    expect((await readDoc(env, `subscriptions/${INACTIVE}`))?.activated).toBe(false);

    const firstAudits = (await readWhere(env, 'platformAudit', 'action', 'trial_expired'))
      .filter((row) => row.tenantId === EXPIRED);
    expect(firstAudits).toHaveLength(1);
    expect((halfway?.notificationsSent as { day7?: boolean })?.day7).toBe(true);
    const halfwayNotice = await readDoc(env, `tenants/${HALFWAY}/notifications/day7`);

    await tickSchedule();

    expect((await readDoc(env, `subscriptions/${EXPIRED}`))?.status).toBe('trial_expired');
    expect((await readDoc(env, `subscriptions/${EXPIRED}`))?.activated).toBe(true);
    expect(millis((await readDoc(env, `tenants/${EXPIRED}/notifications/day15`))?.createdAt)).toBe(millis(expiredNotice?.createdAt));
    expect(millis((await readDoc(env, `tenants/${HALFWAY}/notifications/day7`))?.createdAt)).toBe(millis(halfwayNotice?.createdAt));
    expect((await readDoc(env, `subscriptions/${HALFWAY}`))?.notificationsSent).toMatchObject({ day7: true });
    expect((await readDoc(env, `subscriptions/${ACTIVE}`))?.status).toBe('trial');
    expect(await readDoc(env, `tenants/${ALREADY}/notifications/day15`)).toMatchObject({ title: 'Kept notice' });
    const secondAudits = (await readWhere(env, 'platformAudit', 'action', 'trial_expired'))
      .filter((row) => row.tenantId === EXPIRED);
    expect(secondAudits).toHaveLength(firstAudits.length);
    const healedAudits = (await readWhere(env, 'platformAudit', 'action', 'trial_expired'))
      .filter((row) => row.tenantId === ALREADY);
    expect(healedAudits).toHaveLength(1);
    expect(millis((await readDoc(env, `subscriptions/${ALREADY}`))?.endsAt)).toBe(endsAt[ALREADY]);

    const expiredAgain = await checkout(expiredToken, 'life-expired-after');
    const inactiveAgain = await checkout(inactiveToken, 'life-inactive-after');
    expect(expiredAgain.error?.key).toBe('error.fn.subscriptionInactive');
    expect(inactiveAgain.error?.key).toBe('error.fn.subscriptionInactive');
  });

  it('does not duplicate an expiry audit when two sweeps run together', async () => {
    const tenantId = 'life-race';
    const ends = Date.now() - 60_000;
    await asAdmin(env, (fs) => setDoc(doc(fs, `subscriptions/${tenantId}`), {
      activated: true,
      lifetime: false,
      trial: true,
      status: 'trial',
      source: 'website',
      startsAt: Timestamp.fromMillis(Date.now() - 16 * DAY),
      endsAt: Timestamp.fromMillis(ends),
      notificationsSent: {},
    }));
    const [first, second] = await Promise.all([
      call<{ expired: number }>(adminToken, 'adminRunTrialLifecycle', {}),
      call<{ expired: number }>(adminToken, 'adminRunTrialLifecycle', {}),
    ]);
    expect(first.error ?? second.error).toBeUndefined();
    const stored = await readDoc(env, `subscriptions/${tenantId}`);
    expect(stored?.status).toBe('trial_expired');
    expect(millis(stored?.endsAt)).toBe(ends);
    const audits = (await readWhere(env, 'platformAudit', 'action', 'trial_expired'))
      .filter((row) => row.tenantId === tenantId);
    expect(audits).toHaveLength(1);
    await call(adminToken, 'adminRunTrialLifecycle', {});
    const again = (await readWhere(env, 'platformAudit', 'action', 'trial_expired'))
      .filter((row) => row.tenantId === tenantId);
    expect(again).toHaveLength(1);
  });
});
