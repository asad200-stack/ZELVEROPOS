/**
 * Signed-in checks against the isolated demo-zelvero-featurecenter emulators.
 * Does not touch production or staging.
 */
const AUTH = 'http://127.0.0.1:19309/identitytoolkit.googleapis.com/v1';
const FN = 'http://127.0.0.1:15311/demo-zelvero-featurecenter/europe-west1';
const KEY = 'demo-api-key';
const PASS = 'Feature-verify-pass-1';

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function signIn(email) {
  const session = await fetch(`${AUTH}/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
  }).then((response) => response.json());
  if (!session.idToken) throw new Error(`login ${email}: ${JSON.stringify(session)}`);
  return { email, localId: session.localId, idToken: session.idToken };
}

async function signUp(email) {
  const created = await fetch(`${AUTH}/accounts:signUp?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
  }).then((response) => response.json());
  if (!created.localId) return signIn(email);
  await fetch(`${AUTH}/accounts:update?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: created.localId, emailVerified: true }),
  });
  return signIn(email);
}

async function call(name, token, data = {}) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { ...data, clientApiVersion: 1, clientReleaseVersion: '0.9.0-dev' } }),
  });
  const json = await response.json();
  return { status: response.status, json };
}

function errorStatus(json) {
  return json?.error?.status || json?.error?.message || '';
}

const admin = await signUp('feature-admin@example.test');
const ownerA = await signUp('owner-a@example.test');
const ownerB = await signUp('owner-b@example.test');

const boot = await call('bootstrapSuperAdmin', admin.idToken, {});
record('super admin bootstrap', boot.json?.result?.ok === true, errorStatus(boot.json));

for (const owner of [
  [ownerA, 'Cedar Market', 'cedar-market'],
  [ownerB, 'Pine Market', 'pine-market'],
]) {
  const [account, storeName, subdomain] = owner;
  const signup = await call('completeSignup', account.idToken, {
    fullName: storeName,
    storeName,
    subdomain,
    phone: '03000000',
  });
  record(`signup ${subdomain}`, Boolean(signup.json?.result?.tenantId), errorStatus(signup.json));
  Object.assign(account, await signIn(account.email));
}

const staff = await call('createSubUser', ownerA.idToken, {
  email: 'staff-a@example.test',
  password: PASS,
  fullName: 'Staff A',
  permissions: { canSell: true },
});
record('staff account', Boolean(staff.json?.result?.uid), errorStatus(staff.json));
const staffSession = staff.json?.result?.uid ? await signIn('staff-a@example.test') : { idToken: '' };

const catalog = await call('listFeatureCatalog', admin.idToken, {});
const features = catalog.json?.result?.features ?? [];
const ids = features.map((feature) => feature.id);
record('catalog lists registered features', ids.includes('zelvero_ai') && ids.includes('verify_shelf_note') && ids.includes('verify_paid_label'), ids.join(','));
const ai = features.find((feature) => feature.id === 'zelvero_ai');
record('Zelvero AI is internal testing', ai?.publication === 'internal_testing' && ai?.customerExecution === 'unavailable', ai?.publication);

const aiPublish = await call('publishFeature', admin.idToken, {
  featureId: 'zelvero_ai',
  confirmPublication: true,
  confirmAllEligible: true,
  allEligible: true,
  tenantIds: [],
});
record('Zelvero AI cannot be published', errorStatus(aiPublish.json).includes('FAILED_PRECONDITION') || String(aiPublish.json?.error?.message).includes('customerPath'), errorStatus(aiPublish.json) || aiPublish.json?.error?.message);

const ownerPublish = await call('publishFeature', ownerA.idToken, {
  featureId: 'verify_shelf_note',
  confirmPublication: true,
  confirmAllEligible: false,
  allEligible: false,
  tenantIds: [ownerA.localId],
});
record('owner cannot publish', errorStatus(ownerPublish.json) === 'PERMISSION_DENIED', errorStatus(ownerPublish.json));
const staffPublish = await call('publishFeature', staffSession.idToken, {
  featureId: 'verify_shelf_note',
  confirmPublication: true,
  confirmAllEligible: false,
  allEligible: false,
  tenantIds: [ownerA.localId],
});
record('staff cannot publish', errorStatus(staffPublish.json) === 'PERMISSION_DENIED', errorStatus(staffPublish.json));

for (const id of ['verify_shelf_note', 'verify_paid_label']) {
  const ready = await call('markFeatureReady', admin.idToken, { featureId: id });
  record(`mark ready ${id}`, ready.json?.result?.ok === true, errorStatus(ready.json));
}

const missingConfirm = await call('publishFeature', admin.idToken, {
  featureId: 'verify_shelf_note',
  confirmPublication: true,
  confirmAllEligible: false,
  allEligible: true,
  tenantIds: [],
});
record('all-store publish requires second confirmation', errorStatus(missingConfirm.json) === 'FAILED_PRECONDITION', errorStatus(missingConfirm.json) || missingConfirm.json?.error?.message);

const published = await call('publishFeature', admin.idToken, {
  featureId: 'verify_shelf_note',
  confirmPublication: true,
  confirmAllEligible: false,
  allEligible: false,
  tenantIds: [ownerA.localId],
});
record('selected store publication', published.json?.result?.ok === true && published.json?.result?.tenants === 1, JSON.stringify(published.json?.result || published.json?.error));

const again = await call('publishFeature', admin.idToken, {
  featureId: 'verify_shelf_note',
  confirmPublication: true,
  confirmAllEligible: false,
  allEligible: false,
  tenantIds: [ownerA.localId],
});
record('duplicate publication is idempotent', again.json?.result?.duplicate === true, JSON.stringify(again.json?.result || again.json?.error));

const updatesA = await call('listMyFeatureUpdates', ownerA.idToken, {});
const updatesB = await call('listMyFeatureUpdates', ownerB.idToken, {});
record('eligible tenant is notified', (updatesA.json?.result?.updates ?? []).some((update) => update.featureId === 'verify_shelf_note'), JSON.stringify(updatesA.json?.result?.updates?.map((update) => update.featureId)));
record('other tenant receives nothing', (updatesB.json?.result?.updates ?? []).length === 0, JSON.stringify(updatesB.json?.result || updatesB.json?.error));
record('Zelvero AI is not in a customer update list', !(updatesA.json?.result?.updates ?? []).some((update) => update.featureId === 'zelvero_ai'));

const free = (updatesA.json?.result?.updates ?? []).find((update) => update.featureId === 'verify_shelf_note');
record(
  'review payload has title version and description',
  free?.title === 'Shelf note' && free?.version === '1.0.0' && free?.description?.includes('free test update') && free?.pricing === 'free',
  free?.title,
);

const activated = await call('activateMyFeature', ownerA.idToken, { featureId: 'verify_shelf_note' });
record(
  'free activation returns real stages and a reload flag',
  activated.json?.result?.ok === true && activated.json?.result?.reloadRequired === true && activated.json?.result?.stages?.join(',') === 'checked,entitled,active',
  JSON.stringify(activated.json?.result || activated.json?.error),
);

const paidPublish = await call('publishFeature', admin.idToken, {
  featureId: 'verify_paid_label',
  confirmPublication: true,
  confirmAllEligible: false,
  allEligible: false,
  tenantIds: [ownerA.localId],
});
record('paid feature published', paidPublish.json?.result?.ok === true, JSON.stringify(paidPublish.json?.result || paidPublish.json?.error));
const beforeGrant = await call('activateMyFeature', ownerA.idToken, { featureId: 'verify_paid_label' });
record('WhatsApp-equivalent unpaid request does not activate', errorStatus(beforeGrant.json) === 'FAILED_PRECONDITION', errorStatus(beforeGrant.json));
const grant = await call('grantFeaturePurchase', admin.idToken, { featureId: 'verify_paid_label', tenantId: ownerA.localId, confirm: true });
record('super admin grant', grant.json?.result?.ok === true, errorStatus(grant.json));
const paidOn = await call('activateMyFeature', ownerA.idToken, { featureId: 'verify_paid_label' });
record('approved paid feature activates', paidOn.json?.result?.ok === true, JSON.stringify(paidOn.json?.result || paidOn.json?.error));

const paused = await call('pauseFeature', admin.idToken, { featureId: 'verify_shelf_note', confirm: true });
record('pause', paused.json?.result?.ok === true, errorStatus(paused.json));
const afterPause = await call('listMyFeatureUpdates', ownerA.idToken, {});
const pausedRow = (afterPause.json?.result?.updates ?? []).find((update) => update.featureId === 'verify_shelf_note');
record('paused feature is not activatable', pausedRow?.status === 'unavailable' && pausedRow?.canActivate === false, pausedRow?.status);

const rolled = await call('rollbackFeature', admin.idToken, { featureId: 'verify_paid_label', confirm: true });
record('rollback', rolled.json?.result?.ok === true, errorStatus(rolled.json));
const afterRollback = await call('listMyFeatureUpdates', ownerA.idToken, {});
record(
  'rolled-back feature is gone from the customer list',
  !(afterRollback.json?.result?.updates ?? []).some((update) => update.featureId === 'verify_paid_label'),
);

const killed = await call('setFeatureKillSwitch', admin.idToken, { killed: true, confirm: true });
record('emergency stop', killed.json?.result?.killed === true, errorStatus(killed.json));
const duringKill = await call('activateMyFeature', ownerA.idToken, { featureId: 'verify_shelf_note' });
record('emergency stop blocks activation', errorStatus(duringKill.json) === 'FAILED_PRECONDITION', errorStatus(duringKill.json));
await call('setFeatureKillSwitch', admin.idToken, { killed: false, confirm: true });

const previewEarly = await call('recordFeaturePreview', admin.idToken, { featureId: 'zelvero_ai' });
record('preview requires the internal demo store', errorStatus(previewEarly.json) === 'FAILED_PRECONDITION', errorStatus(previewEarly.json));
const demo = await call('adminProvisionInternalDemo', admin.idToken, {});
record('internal demo store', demo.json?.result?.ok === true, errorStatus(demo.json));
const adminAgain = await signIn('feature-admin@example.test');
const preview = await call('recordFeaturePreview', adminAgain.idToken, { featureId: 'zelvero_ai' });
record('preview recording', preview.json?.result?.ok === true && preview.json?.result?.path === '/dashboard', JSON.stringify(preview.json?.result || preview.json?.error));

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
