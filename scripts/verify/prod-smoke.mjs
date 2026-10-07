#!/usr/bin/env node
/**
 * Controlled production backend smoke test (Stage 4). Uses the real Firebase web SDK exactly like the
 * app (Auth, callables, Firestore, Storage). Operator-side checks are READ-ONLY (gcloud credentials).
 *
 *   node scripts/verify/prod-smoke.mjs zelvoropos availability  public signup pre-check leaks no e-mail state
 *   node scripts/verify/prod-smoke.mjs zelvoropos signup      create the test owner + super-admin Auth identity
 *   node scripts/verify/prod-smoke.mjs zelvoropos backend     after both e-mails are verified
 *   node scripts/verify/prod-smoke.mjs zelvoropos resume-after-sale  continue from the recorded sale
 *   node scripts/verify/prod-smoke.mjs zelvoropos finalize    deactivate the TEST store (supported admin flow)
 *   node scripts/verify/prod-smoke.mjs zelvoropos handover    send the super-admin password-reset e-mail
 *   node scripts/verify/prod-smoke.mjs zelvoropos handed-over confirm the temporary super-admin password is dead
 *
 * Credentials of the test accounts live only in the OS temp directory (never in the repository).
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, getDocs, collection, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getBytes, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { checkFirebaseTargets } from '../firebase-guard.mjs';

const [project, phase] = process.argv.slice(2);
const { problems: guard, active } = checkFirebaseTargets();
if (guard.length || project !== active) {
  console.error('Blocked by the Firebase isolation guard:', guard.join('; ') || `${project} is not the configured project`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.production', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim()];
  }),
);
if (env.VITE_FIREBASE_PROJECT_ID !== project || env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  console.error('.env.production does not target', project);
  process.exit(1);
}
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const REGION = env.VITE_FIREBASE_FUNCTIONS_REGION;

const OWNER = 'asad28486+zelvero-test@gmail.com';
const CASHIER = 'asad28486+zelvero-test-cashier@gmail.com';
const SUPER_ADMIN = 'asad28486@gmail.com';
const SUBDOMAIN = 'zelvero-prod-test';
const STORE_NAME = 'ZELVERO PRODUCTION TEST';
const PRODUCT_NAME = 'TEST PRODUCT — DELETE LATER';
const RATE = 89_500;

const stateDir = join(tmpdir(), 'zelvero-smoke');
const stateFile = join(stateDir, 'state.json');
const loadState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {});
const saveState = (s) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
};
const password = () => randomBytes(18).toString('base64url');

/* ------------------------------------------------------------------ reporting */

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
}
function critical(label, ok, detail) {
  if (!check(label, ok, detail)) {
    console.log('\nSTOP: a critical check failed.');
    process.exit(1);
  }
}
async function denied(label, fn, expected) {
  try {
    const r = await fn();
    critical(label, false, `ALLOWED ${JSON.stringify(r?.data ?? r ?? null).slice(0, 200)}`);
  } catch (e) {
    const got = `${e.code} ${e.message}`;
    critical(label, expected.test(got), got);
  }
}
const section = (t) => console.log(`\n=== ${t}`);

/* ------------------------------------------------------------------ clients */

function client(name) {
  const app = initializeApp(config, `${name}-${Date.now()}`);
  const fns = getFunctions(app, REGION);
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
    call: (fn, data) => httpsCallable(fns, fn)(data),
  };
}
async function signedIn(name, email, pwd) {
  const c = client(name);
  const cred = await signInWithEmailAndPassword(c.auth, email, pwd);
  await reload(cred.user);
  await cred.user.getIdToken(true);
  return { ...c, user: c.auth.currentUser };
}
const claimsOf = async (user, force = true) => (await user.getIdTokenResult(force)).claims;

/* ------------------------------------------------------- operator (read-only) */

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const FS = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function rest(url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(json.error)}`);
  return json;
}
function value(v) {
  if (!v) return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fields(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(value);
  return v;
}
const fields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, value(v)]));
const under = (parent, verb) => (parent ? `${FS}/${parent}:${verb}` : `${FS}:${verb}`);
const adminDoc = async (path) => {
  const d = await rest(`${FS}/${path}`);
  return d ? fields(d.fields) : null;
};
async function adminCount(parent, collectionId, where = {}) {
  const filters = Object.entries(where).map(([field, v]) => ({
    fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v } },
  }));
  const structuredQuery = {
    from: [{ collectionId }],
    ...(filters.length && { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } }),
  };
  const r = await rest(under(parent, 'runAggregationQuery'), {
    structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: 'n', count: {} }] },
  });
  return Number(r[0].result.aggregateFields.n.integerValue);
}
async function adminList(parent, collectionId) {
  const r = await rest(under(parent, 'runQuery'), { structuredQuery: { from: [{ collectionId }] } });
  return r.filter((x) => x.document).map((x) => ({ id: x.document.name.split('/').pop(), ...fields(x.document.fields) }));
}
async function authUser(email) {
  const r = await rest(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, { email: [email] });
  return r?.users?.[0] ?? null;
}
/** Firestore returns map fields in no particular order: compare documents with sorted keys. */
const canon = (x) =>
  Array.isArray(x) ? x.map(canon)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])]))
      : x;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const businessDate = (ms) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function ledgerState(t, productId) {
  const date = businessDate(Date.now());
  const [product, cashbox, counter, daily, movements, cashTx, sales, returns] = await Promise.all([
    adminDoc(`tenants/${t}/products/${productId}`),
    adminDoc(`tenants/${t}/cashbox/summary`),
    adminDoc(`tenants/${t}/counters/sales`),
    adminDoc(`tenants/${t}/dailyStats/${date}`),
    adminCount(`tenants/${t}`, 'stockMovements'),
    adminCount(`tenants/${t}`, 'cashTransactions'),
    adminCount(`tenants/${t}`, 'sales'),
    adminCount(`tenants/${t}`, 'returns'),
  ]);
  return {
    stock: product?.stock,
    drawerUsdCents: cashbox?.usdCents,
    drawerLbp: cashbox?.lbp,
    counterNext: counter?.nextId,
    daily: daily ?? {},
    movements,
    cashTx,
    sales,
    returns,
  };
}
const show = (label, s) =>
  console.log(`      ${label}: stock=${s.stock} drawer=$${(s.drawerUsdCents / 100).toFixed(2)} (LBP ${s.drawerLbp}) counter.nextId=${s.counterNext} `
    + `movements=${s.movements} cashTx=${s.cashTx} sales=${s.sales} returns=${s.returns} daily=${JSON.stringify(
      Object.fromEntries(Object.entries(s.daily).filter(([k]) => !['updatedAt', 'date'].includes(k))),
    )}`);

/* ------------------------------------------------------------------ payloads */

const productPayload = {
  product: {
    name: PRODUCT_NAME,
    category: '',
    barcode: '',
    prices: { retail: { usdCents: 100, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
    costUsdCents: 40,
    minStock: null,
    supplierId: null,
    supplierName: '',
    expiryDate: null,
    imeiTracking: false,
  },
  initialStock: 10,
  initialImeis: [],
};
const checkout = (saleId, productId, expectedTotal = 100) => ({
  saleId,
  kind: 'cash',
  currency: 'USD',
  rate: RATE,
  customerId: null,
  debtLineUsdCents: null,
  lines: [{ productId, tier: 'retail', quantity: 1, customUsdCents: null, imei: null, expectedUnitUsdCents: 100 }],
  expectedTotalUsdCents: expectedTotal,
  cash: { receivedUsdCents: 100, receivedLbp: 0 },
  clientCreatedAtMs: Date.now(),
});
/** A checkout that can never succeed (wrong confirmed total): any denial must happen BEFORE pricing. */
const harmlessCheckout = (productId) => checkout(`probe${randomBytes(6).toString('hex')}`, productId, 1);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

/* ================================================================== phases */

async function signupPhase() {
  const s = loadState();
  if (s.superAdminUid) throw new Error(`signup already completed; state: ${stateFile}`);
  const owner = client('owner');
  let cred;
  if (s.ownerUid) {
    section('Resuming an interrupted signup (the app\'s setup screen): sign in -> completeSignup');
    cred = await signInWithEmailAndPassword(owner.auth, OWNER, s.ownerPassword);
    critical('signed in as the existing test owner', cred.user.uid === s.ownerUid, cred.user.uid);
  } else {
    s.ownerPassword = password();
    s.superAdminTempPassword = password();
    saveState(s);
    section('Real signup flow (authService.register): availability -> Auth user -> verification e-mail -> completeSignup');
    const avail = await owner.call('checkSignupAvailability', { subdomain: SUBDOMAIN });
    critical('subdomain available before signup', avail.data.subdomainAvailable === true, JSON.stringify(avail.data));
    cred = await createUserWithEmailAndPassword(owner.auth, OWNER, s.ownerPassword);
    s.ownerUid = cred.user.uid;
    saveState(s);
    check('Auth user created', !!cred.user.uid, cred.user.uid);
    await sendEmailVerification(cred.user);
    check('verification e-mail sent (sendEmailVerification resolved)', true);
  }
  const done = await owner.call('completeSignup', { fullName: 'TEST OWNER', storeName: STORE_NAME, subdomain: SUBDOMAIN, phone: '+000 TEST' });
  critical('completeSignup created the tenant = owner uid', done.data.tenantId === s.ownerUid, done.data.tenantId);
  s.tenantId = done.data.tenantId;
  saveState(s);
  await cred.user.getIdToken(true);

  section('Duplicate signup protection');
  const again = await owner.call('checkSignupAvailability', { subdomain: SUBDOMAIN });
  check('availability now reports the subdomain taken', again.data.subdomainAvailable === false, JSON.stringify(again.data));
  await denied('second Auth signup with the same e-mail', () => createUserWithEmailAndPassword(client('dup').auth, OWNER, password()), /email-already-in-use/);
  const repeat = await owner.call('completeSignup', { fullName: 'TEST OWNER', storeName: STORE_NAME, subdomain: SUBDOMAIN, phone: '+000 TEST' });
  check('repeated completeSignup is idempotent (same tenant)', repeat.data.tenantId === s.tenantId);
  check('exactly one owner profile for the e-mail', (await adminList('', 'users')).filter((u) => u.email === OWNER).length === 1);

  section('Unverified owner');
  const c = await claimsOf(cred.user);
  check('token: email_verified=false, tenantId=uid, role=owner, active, subUntil=0',
    c.email_verified === false && c.tenantId === s.tenantId && c.role === 'owner' && c.active === true && c.subUntil === 0, JSON.stringify(c));
  await denied('unverified: posCreateProduct', () => owner.call('posCreateProduct', productPayload), /permission-denied error\.permissionDenied/);
  await denied('unverified: read tenant document', () => getDoc(doc(owner.db, `tenants/${s.tenantId}`)), /permission-denied/);
  await denied('unverified: read tenant settings', () => getDoc(doc(owner.db, `tenants/${s.tenantId}/settings/main`)), /permission-denied/);
  const profile = await getDoc(doc(owner.db, `users/${s.ownerUid}`));
  check('unverified: own profile readable (needed for the verification screen)', profile.exists() && profile.data().role === 'owner');

  section('Server state after signup (operator read-only)');
  const sub = await adminDoc(`subscriptions/${s.tenantId}`);
  check('subscription exists and is inactive (SIGNUP_TRIAL_DAYS=0)', sub && sub.activated === false && sub.trial === false && sub.endsAt === null, JSON.stringify(sub));
  const store = await adminDoc(`stores/${s.tenantId}`);
  check('store marked TEST', store?.storeName === STORE_NAME && store?.subdomain === SUBDOMAIN, store?.storeName);
  check('tenant, settings, counter, drawer, subdomain reservation exist',
    !!(await adminDoc(`tenants/${s.tenantId}`)) && !!(await adminDoc(`tenants/${s.tenantId}/settings/main`))
    && (await adminDoc(`tenants/${s.tenantId}/counters/sales`))?.nextId === 1
    && (await adminDoc(`tenants/${s.tenantId}/cashbox/summary`))?.usdCents === 0
    && (await adminDoc(`storeSubdomains/${SUBDOMAIN}`))?.tenantId === s.tenantId);
  const authRecord = await authUser(OWNER);
  check('Auth record: emailVerified=false, enabled', authRecord.emailVerified !== true && !authRecord.disabled);

  section('Super-admin identity: Auth user only (no signup, no store)');
  const sa = client('sa');
  const saCred = await createUserWithEmailAndPassword(sa.auth, SUPER_ADMIN, s.superAdminTempPassword);
  s.superAdminUid = saCred.user.uid;
  saveState(s);
  check('super-admin Auth user created', !!s.superAdminUid, s.superAdminUid);
  await sendEmailVerification(saCred.user);
  check('super-admin verification e-mail sent', true);
  await denied('unverified super admin: bootstrapSuperAdmin', () => sa.call('bootstrapSuperAdmin', {}), /failed-precondition error\.fn\.emailNotVerified/);
  check('no users/ profile for the super admin', (await adminDoc(`users/${s.superAdminUid}`)) === null);
  check('no store/tenant for the super admin', (await adminDoc(`stores/${s.superAdminUid}`)) === null && (await adminDoc(`tenants/${s.superAdminUid}`)) === null);
}

async function backendPhase() {
  const s = loadState();
  if (!s.ownerUid || !s.superAdminUid) throw new Error('run the signup phase first');
  const t = s.tenantId;

  section('Email verification (Firebase action handler) and session refresh');
  check('Auth record: test owner emailVerified', (await authUser(OWNER)).emailVerified === true);
  check('Auth record: super admin emailVerified', (await authUser(SUPER_ADMIN)).emailVerified === true);
  const owner = await signedIn('owner', OWNER, s.ownerPassword);
  let c = await claimsOf(owner.user);
  critical('owner session after reload: email_verified=true, subUntil=0', c.email_verified === true && c.subUntil === 0, JSON.stringify(c));

  section('Auth: invalid password, login');
  await denied('sign-in with a wrong password', () => signInWithEmailAndPassword(client('bad').auth, OWNER, 'wrong-password-123'), /auth\/invalid-credential/);
  check('sign-in with the right password', owner.user.email === OWNER);

  section('Inactive subscription (verified owner)');
  const settings = await getDoc(doc(owner.db, `tenants/${t}/settings/main`));
  check('verified owner can read own store settings', settings.exists() && settings.data().storeName === STORE_NAME);
  await denied('inactive: posCreateProduct', () => owner.call('posCreateProduct', productPayload), /failed-precondition error\.fn\.subscriptionInactive/);
  await denied('inactive: createSubUser', () => owner.call('createSubUser', { email: CASHIER, password: password(), fullName: 'TEST CASHIER', permissions: { canSell: true } }), /failed-precondition error\.fn\.subscriptionInactive/);
  await denied('inactive: direct settings write', () => updateDoc(doc(owner.db, `tenants/${t}/settings/main`), { storeName: 'X', updatedAt: serverTimestamp() }), /permission-denied/);

  section('Super admin: bootstrap through SUPER_ADMIN_EMAILS');
  const sa = await signedIn('sa', SUPER_ADMIN, s.superAdminTempPassword);
  await denied('adminSetSubscription before bootstrap', () => sa.call('adminSetSubscription', { uid: s.ownerUid, action: 'activate', days: 7 }), /permission-denied error\.fn\.notAllowed/);
  await sa.call('bootstrapSuperAdmin', {});
  const sc = await claimsOf(sa.user);
  critical('super-admin claim present, no tenant claims', sc.superAdmin === true && !('tenantId' in sc) && sc.email_verified === true, JSON.stringify(sc));
  check('still no users/ profile, store or tenant for the super admin',
    (await adminDoc(`users/${s.superAdminUid}`)) === null && (await adminDoc(`tenants/${s.superAdminUid}`)) === null);
  await denied('test owner cannot bootstrap super admin (not on the allow-list)', () => owner.call('bootstrapSuperAdmin', {}), /permission-denied error\.fn\.notAllowed/);
  await denied('test owner cannot call adminSetSubscription', () => owner.call('adminSetSubscription', { uid: s.ownerUid, action: 'lifetime' }), /permission-denied error\.fn\.notAllowed/);
  await denied('super admin cannot read tenant business data', () => getDoc(doc(sa.db, `tenants/${t}/settings/main`)), /permission-denied/);
  const list = await sa.call('adminListAccounts', {});
  const listed = list.data.accounts.find((a) => a.uid === s.ownerUid);
  check('adminListAccounts lists the TEST store as inactive', listed?.storeName === STORE_NAME && listed.subscription.activated === false);

  section('Activate the TEST store with adminSetSubscription');
  const cvBefore = (await getDoc(doc(owner.db, `users/${s.ownerUid}`))).data().claimsVersion;
  await sa.call('adminSetSubscription', { uid: s.ownerUid, action: 'activate', days: 7 });
  const sub = await adminDoc(`subscriptions/${t}`);
  check('subscription activated for ~7 days by the super admin',
    sub.activated === true && sub.updatedBy === s.superAdminUid && Math.abs(Date.parse(sub.endsAt) - Date.now() - 7 * 86_400_000) < 600_000, JSON.stringify(sub));
  const profile = (await getDoc(doc(owner.db, `users/${s.ownerUid}`))).data();
  const stale = await claimsOf(owner.user, false);
  check('profile claimsVersion bumped above the token (the app\'s refresh signal)', profile.claimsVersion > cvBefore && profile.claimsVersion > (stale.cv ?? 0), `${cvBefore} -> ${profile.claimsVersion}, token cv ${stale.cv}`);
  c = await claimsOf(owner.user, true);
  critical('after the app\'s forced token refresh: subUntil in the future, cv matches', c.subUntil > Date.now() && c.cv === profile.claimsVersion, `subUntil ${new Date(c.subUntil).toISOString()}`);

  section('Product (posCreateProduct)');
  const created = await owner.call('posCreateProduct', productPayload);
  const productId = created.data.id;
  s.productId = productId;
  saveState(s);
  const product = await adminDoc(`tenants/${t}/products/${productId}`);
  critical('product created with stock 10, $1.00 retail, $0.40 cost, createdBy owner',
    product.name === PRODUCT_NAME && product.stock === 10 && product.prices.retail.usdCents === 100 && product.costUsdCents === 40 && product.createdBy === s.ownerUid);
  critical('exactly one initial stock movement', (await adminCount(`tenants/${t}`, 'stockMovements', { productId, type: 'initial' })) === 1);

  section('Storage (authenticated)');
  const imagePath = `tenants/${t}/products/${productId}-${Date.now()}.jpg`;
  await uploadBytes(ref(owner.storage, imagePath), JPEG, { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000' });
  const url = await getDownloadURL(ref(owner.storage, imagePath));
  check('owner uploads a JPEG into its own tenant folder', !!url, imagePath);
  await updateDoc(doc(owner.db, `tenants/${t}/products/${productId}`), { imageUrl: url, imagePath, updatedAt: serverTimestamp() });
  const withImage = await adminDoc(`tenants/${t}/products/${productId}`);
  check('product references the uploaded image (setProductImage flow)', withImage.imagePath === imagePath && withImage.imageUrl === url && withImage.stock === 10);
  s.imagePath = imagePath;
  saveState(s);
  await denied('upload into another tenant folder', () => uploadBytes(ref(owner.storage, `tenants/not-my-tenant/products/x-${Date.now()}.jpg`), JPEG, { contentType: 'image/jpeg' }), /storage\/unauthorized/);
  await denied('upload SVG into own folder', () => uploadBytes(ref(owner.storage, `tenants/${t}/products/x-${Date.now()}.svg`), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { contentType: 'image/svg+xml' }), /storage\/unauthorized/);
  await denied('upload 2 MB + 1 byte into own folder', () => uploadBytes(ref(owner.storage, `tenants/${t}/products/big-${Date.now()}.jpg`), Buffer.alloc(2 * 1024 * 1024 + 1), { contentType: 'image/jpeg' }), /storage\/unauthorized/);
  await denied('upload outside tenant paths', () => uploadBytes(ref(owner.storage, `public/x-${Date.now()}.jpg`), JPEG, { contentType: 'image/jpeg' }), /storage\/unauthorized/);
  await denied('user of no tenant (super admin) reads the image through the SDK', () => getBytes(ref(sa.storage, imagePath)), /storage\/unauthorized/);
  await denied('user of no tenant (super admin) writes into the TEST tenant', () => uploadBytes(ref(sa.storage, `tenants/${t}/products/sa-${Date.now()}.jpg`), JPEG, { contentType: 'image/jpeg' }), /storage\/unauthorized/);
  const anon = await fetch(`https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${encodeURIComponent(imagePath)}`);
  check('unauthenticated metadata/read without the download token is denied', anon.status === 403, `HTTP ${anon.status}`);
  const objects = await rest(`https://storage.googleapis.com/storage/v1/b/${config.storageBucket}/o?prefix=tenants/`);
  check('bucket holds exactly the one product image', (objects.items ?? []).length === 1 && objects.items[0].name === imagePath, (objects.items ?? []).map((o) => o.name).join(', '));

  section('Controlled sale ($1.00 cash, USD, quantity 1)');
  const saleId = `smoke${randomBytes(8).toString('hex')}`;
  s.saleId = saleId;
  saveState(s);
  const before = await ledgerState(t, productId);
  show('before', before);
  const payload = checkout(saleId, productId);
  const first = await owner.call('posCheckout', payload);
  const sale = await adminDoc(`tenants/${t}/sales/${saleId}`);
  const after = await ledgerState(t, productId);
  show('after ', after);
  s.invoiceNumber = sale.invoiceNumber;
  saveState(s);
  critical('server-generated invoice returned and stored', first.data.duplicate === false && /^INV-/.test(first.data.sale.invoiceNumber) && sale.invoiceNumber === first.data.sale.invoiceNumber, sale.invoiceNumber);
  critical('stock 10 -> 9', before.stock === 10 && after.stock === 9);
  critical('exactly one sale stock movement (-1, stockAfter 9)',
    (await adminCount(`tenants/${t}`, 'stockMovements', { refId: saleId })) === 1 && after.movements === before.movements + 1);
  const movement = (await adminList(`tenants/${t}`, 'stockMovements')).find((m) => m.refId === saleId);
  critical('movement content', movement.type === 'sale' && movement.quantity === -1 && movement.stockAfter === 9 && movement.refNumber === sale.invoiceNumber && movement.createdBy === s.ownerUid);
  critical('drawer +$1.00 exactly, LBP unchanged', after.drawerUsdCents === before.drawerUsdCents + 100 && after.drawerLbp === before.drawerLbp);
  critical('exactly one cash transaction', after.cashTx === before.cashTx + 1 && (await adminCount(`tenants/${t}`, 'cashTransactions', { refId: saleId })) === 1);
  critical('invoice counter +1', after.counterNext === before.counterNext + 1);
  const d = (k) => (after.daily[k] ?? 0) - (before.daily[k] ?? 0);
  critical('dailyStats: salesCount +1, revenue +100, cost +40, cashSales +100', d('salesCount') === 1 && d('revenueUsdCents') === 100 && d('costUsdCents') === 40 && d('cashSalesUsdCents') === 100, JSON.stringify(after.daily));
  critical('sale snapshot: total 100, cost 40 (profit 60), item cost 40, unit 100',
    sale.totalUsdCents === 100 && sale.costUsdCents === 40 && sale.items[0].costUsdCents === 40 && sale.items[0].unitUsdCents === 100 && sale.items[0].quantity === 1);
  critical('sale creator, tenant path and payment', sale.createdBy === s.ownerUid && sale.payment.receivedUsdCents === 100 && sale.kind === 'cash' && sale.currency === 'USD');
  check('sale creator name', sale.createdByName === 'TEST OWNER', sale.createdByName);
  await afterSalePhase({ s, t, owner, sa, productId, saleId, payload, sale, after });
}

/** Continues after a recorded sale (also used to resume a run that stopped after the sale). */
async function resumeAfterSalePhase() {
  const s = loadState();
  if (!s.saleId || !s.productId) throw new Error('no recorded sale to resume from');
  const t = s.tenantId;
  section(`Resuming after sale ${s.invoiceNumber} (${s.saleId})`);
  const owner = await signedIn('owner', OWNER, s.ownerPassword);
  const sa = await signedIn('sa', SUPER_ADMIN, s.superAdminTempPassword);
  critical('owner session active (subUntil in the future)', (await claimsOf(owner.user)).subUntil > Date.now());
  const sale = await adminDoc(`tenants/${t}/sales/${s.saleId}`);
  const after = await ledgerState(t, s.productId);
  show('current', after);
  critical('state is exactly one sale later (stock 9, drawer $1.00, counter 2, 1 sale, 0 returns)',
    after.stock === 9 && after.drawerUsdCents === 100 && after.counterNext === 2 && after.sales === 1 && after.returns === 0 && sale.returnStatus === 'none');
  const payload = { ...checkout(s.saleId, s.productId), clientCreatedAtMs: sale.createdAtMs };
  await afterSalePhase({ s, t, owner, sa, productId: s.productId, saleId: s.saleId, payload, sale, after });
}

async function afterSalePhase({ s, t, owner, sa, productId, saleId, payload, sale, after }) {
  section('Idempotency: same saleId (clientOperationId) retried');
  const retry = await owner.call('posCheckout', payload);
  const retry2 = await owner.call('posCheckout', { ...payload, clientCreatedAtMs: Date.now() });
  const afterRetry = await ledgerState(t, productId);
  show('after retries', afterRetry);
  critical('retry returns the original sale (duplicate=true, same invoice)',
    retry.data.duplicate === true && retry.data.sale.invoiceNumber === sale.invoiceNumber && retry2.data.duplicate === true && retry2.data.sale.invoiceNumber === sale.invoiceNumber);
  critical('no second invoice, stock 9, drawer unchanged, no new movement/cash tx, counter unchanged, dailyStats unchanged',
    afterRetry.sales === after.sales && afterRetry.stock === 9 && afterRetry.drawerUsdCents === after.drawerUsdCents
    && afterRetry.movements === after.movements && afterRetry.cashTx === after.cashTx && afterRetry.counterNext === after.counterNext
    && same(afterRetry.daily, after.daily));

  section('Full return');
  const ret = await owner.call('posReturn', { saleId, lines: [{ index: 0, quantity: 1 }], reason: 'production smoke test' });
  const afterReturn = await ledgerState(t, productId);
  show('after return', afterReturn);
  const returns = await adminList(`tenants/${t}`, 'returns');
  s.returnNumber = ret.data.saleReturn.number;
  saveState(s);
  critical('exactly one return record (RF-, $1.00 refund)', returns.length === 1 && /^RF-/.test(returns[0].number) && returns[0].amountUsdCents === 100 && returns[0].refundUsdCents === 100 && returns[0].saleId === saleId, returns[0]?.number);
  critical('stock 9 -> 10', afterReturn.stock === 10);
  critical('exactly one return stock movement (+1)', (await adminCount(`tenants/${t}`, 'stockMovements', { refId: returns[0].id, type: 'return' })) === 1 && afterReturn.movements === afterRetry.movements + 1);
  critical('drawer -$1.00 (refund), one refund cash transaction', afterReturn.drawerUsdCents === afterRetry.drawerUsdCents - 100 && afterReturn.cashTx === afterRetry.cashTx + 1);
  const r = (k) => (afterReturn.daily[k] ?? 0) - (afterRetry.daily[k] ?? 0);
  critical('dailyStats: returnsCount +1, returns +100, returnsCost +40, sales figures unchanged',
    r('returnsCount') === 1 && r('returnsUsdCents') === 100 && r('returnsCostUsdCents') === 40 && r('salesCount') === 0 && r('revenueUsdCents') === 0);
  const saleAfter = await adminDoc(`tenants/${t}/sales/${saleId}`);
  critical('original sale kept (same invoice, totals) and marked fully returned',
    saleAfter.invoiceNumber === sale.invoiceNumber && saleAfter.totalUsdCents === 100 && saleAfter.returnStatus === 'full' && saleAfter.items[0].returnedQty === 1 && saleAfter.refundedUsdCents === 100 && afterReturn.sales === afterRetry.sales);
  await denied('second full return rejected', () => owner.call('posReturn', { saleId, lines: [{ index: 0, quantity: 1 }], reason: 'again' }), /failed-precondition error\.return\./);
  const afterSecond = await ledgerState(t, productId);
  critical('rejected return changed nothing', afterSecond.stock === 10 && afterSecond.returns === 1 && afterSecond.drawerUsdCents === afterReturn.drawerUsdCents && afterSecond.movements === afterReturn.movements);

  section('Security against the real project');
  await denied('unauthenticated callable (posCheckout)', () => client('anon').call('posCheckout', harmlessCheckout(productId)), /unauthenticated/);
  await denied('signed-in user of no tenant uses the TEST product id (super admin)', () => sa.call('posCheckout', harmlessCheckout(productId)), /permission-denied error\.permissionDenied/);
  await denied('owner uses a product id that is not in its tenant', () => owner.call('posCheckout', { ...harmlessCheckout('productOfAnotherTenant'), expectedTotalUsdCents: 100 }), /not-found error\.productMissing/);
  await denied('direct client stock modification', () => updateDoc(doc(owner.db, `tenants/${t}/products/${productId}`), { stock: 999 }), /permission-denied/);
  await denied('direct client drawer modification', () => setDoc(doc(owner.db, `tenants/${t}/cashbox/summary`), { usdCents: 999_999, lbp: 0 }, { merge: true }), /permission-denied/);
  await denied('direct sale document creation', () => setDoc(doc(owner.db, `tenants/${t}/sales/forged${Date.now()}`), { invoiceNumber: 'INV-FAKE', totalUsdCents: 1 }), /permission-denied/);
  await denied('direct stock movement creation', () => setDoc(doc(owner.db, `tenants/${t}/stockMovements/forged${Date.now()}`), { productId, quantity: 50 }), /permission-denied/);
  await denied('direct dailyStats write', () => setDoc(doc(owner.db, `tenants/${t}/dailyStats/${businessDate(Date.now())}`), { revenueUsdCents: 1 }, { merge: true }), /permission-denied/);
  await denied('owner writes own subscription', () => setDoc(doc(owner.db, `subscriptions/${t}`), { lifetime: true }, { merge: true }), /permission-denied/);
  await denied('owner reads another tenant', () => getDoc(doc(owner.db, 'tenants/not-my-tenant/settings/main')), /permission-denied/);
  const finalState = await ledgerState(t, productId);
  critical('security probes changed nothing', same(finalState, afterSecond));

  section('Disabled user (sub-user deactivated through updateSubUser)');
  s.cashierPassword = password();
  saveState(s);
  const sub1 = await owner.call('createSubUser', { email: CASHIER, password: s.cashierPassword, fullName: 'TEST CASHIER', permissions: { canSell: true } });
  s.cashierUid = sub1.data.uid;
  saveState(s);
  const cashier = await signedIn('cashier', CASHIER, s.cashierPassword);
  const cc = await claimsOf(cashier.user);
  check('cashier claims: subUser, tenant, canSell only', cc.role === 'subUser' && cc.tenantId === t && cc.perms?.canSell === true && Object.keys(cc.perms).length === 1, JSON.stringify(cc.perms));
  await denied('cashier lists sales (no canViewSales)', () => getDocs(collection(cashier.db, `tenants/${t}/sales`)), /permission-denied/);
  await denied('cashier uploads a product image (no product permission)', () => uploadBytes(ref(cashier.storage, `tenants/${t}/products/c-${Date.now()}.jpg`), JPEG, { contentType: 'image/jpeg' }), /storage\/unauthorized/);
  await owner.call('updateSubUser', { uid: s.cashierUid, isActive: false });
  const cashierAuth = await authUser(CASHIER);
  check('Auth account disabled', cashierAuth.disabled === true);
  await denied('disabled cashier (old token) calls posCheckout', () => cashier.call('posCheckout', harmlessCheckout(productId)), /permission-denied error\.userInactive|unauthenticated/);
  let staleRead = 'denied';
  try {
    await getDoc(doc(cashier.db, `tenants/${t}/products/${productId}`));
    staleRead = 'ALLOWED';
  } catch { /* denied */ }
  console.log(`INFO  disabled cashier's unexpired ID token reading a product through Firestore rules: ${staleRead} (rules see token claims until the token expires, max 1 hour)`);
  await denied('disabled cashier cannot refresh its token', () => cashier.user.getIdToken(true), /auth\/(user-disabled|user-token-expired)/);
  await denied('disabled cashier cannot sign in again', () => signInWithEmailAndPassword(client('c2').auth, CASHIER, s.cashierPassword), /auth\/user-disabled/);
  critical('disabled cashier changed nothing', same(await ledgerState(t, productId), finalState));

  section('Auth: password reset request, logout');
  await sendPasswordResetEmail(client('reset').auth, OWNER);
  check('password-reset e-mail requested for the test owner', true);
  await signOut(owner.auth);
  check('logout clears the session', owner.auth.currentUser === null);
  await denied('after logout: tenant read', () => getDoc(doc(owner.db, `tenants/${t}/settings/main`)), /permission-denied/);
  await denied('after logout: callable', () => owner.call('posCheckout', harmlessCheckout(productId)), /unauthenticated/);
}

async function finalizePhase() {
  const s = loadState();
  const t = s.tenantId;
  section('Deactivate the TEST store with adminSetSubscription');
  const sa = await signedIn('sa', SUPER_ADMIN, s.superAdminTempPassword);
  const owner = await signedIn('owner', OWNER, s.ownerPassword);
  const before = await ledgerState(t, s.productId);
  await sa.call('adminSetSubscription', { uid: s.ownerUid, action: 'deactivate' });
  const sub = await adminDoc(`subscriptions/${t}`);
  check('subscription deactivated by the super admin', sub.activated === false && sub.updatedBy === s.superAdminUid, JSON.stringify(sub));
  await denied('owner session revoked: token refresh', () => owner.user.getIdToken(true), /auth\/user-token-expired/);
  const again = await signedIn('owner2', OWNER, s.ownerPassword);
  const c = await claimsOf(again.user);
  check('owner can sign in again; claims subUntil=0', c.subUntil === 0, JSON.stringify(c));
  check('owner can still read its history (audit trail intact)', (await getDoc(doc(again.db, `tenants/${t}/sales/${s.saleId}`))).data()?.invoiceNumber === s.invoiceNumber);
  await denied('inactive again: posCreateProduct', () => again.call('posCreateProduct', productPayload), /failed-precondition error\.fn\.subscriptionInactive/);
  await denied('inactive again: posCheckout', () => again.call('posCheckout', harmlessCheckout(s.productId)), /failed-precondition error\.fn\.subscriptionInactive/);
  check('history untouched', same(await ledgerState(t, s.productId), before));
  const store = await adminDoc(`stores/${t}`);
  console.log(`INFO  final: store "${store.storeName}" (${store.subdomain}), product "${PRODUCT_NAME}", sale ${s.invoiceNumber}, return ${s.returnNumber}`);
}

async function handoverPhase() {
  section('Super-admin password handover');
  await sendPasswordResetEmail(client('reset').auth, SUPER_ADMIN);
  check(`password-reset e-mail sent to ${SUPER_ADMIN}`, true);
}

async function handedOverPhase() {
  const s = loadState();
  section('Temporary super-admin password no longer works');
  await denied('sign-in with the temporary password', () => signInWithEmailAndPassword(client('old').auth, SUPER_ADMIN, s.superAdminTempPassword), /auth\/invalid-credential/);
  const record = await authUser(SUPER_ADMIN);
  check('password changed after the temporary one was issued', Number(record.passwordUpdatedAt) > Number(s.handoverIssuedAt ?? 0), new Date(Number(record.passwordUpdatedAt)).toISOString());
  check('super-admin claim kept', JSON.parse(record.customAttributes ?? '{}').superAdmin === true);
  delete s.superAdminTempPassword;
  saveState(s);
  console.log('INFO  temporary super-admin password removed from the local state file');
}

/** Public signup pre-check must not reveal whether an e-mail has an account (raw HTTP, anonymous). */
async function availabilityPhase() {
  section('checkSignupAvailability: no e-mail enumeration');
  const url = `https://${REGION}-${project}.cloudfunctions.net/checkSignupAvailability`;
  const probe = async (data) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    const body = await res.text();
    return { exchange: { status: res.status, contentType: res.headers.get('content-type'), body } };
  };
  await probe({ subdomain: 'warm-up-probe' });
  const emails = [SUPER_ADMIN, OWNER, CASHIER, 'nobody-zelvero-probe@example.com', 'not-an-email', undefined];
  const free = [];
  const taken = [];
  for (let round = 0; round < 3; round++) {
    for (const email of emails) {
      free.push({ email, ...(await probe({ subdomain: 'zelvero-free-probe', ...(email !== undefined && { email }) })) });
      taken.push({ email, ...(await probe({ subdomain: SUBDOMAIN, ...(email !== undefined && { email }) })) });
    }
  }
  const distinct = (rows) => [...new Set(rows.map((r) => JSON.stringify(r.exchange)))];
  critical('free subdomain: one identical response for existing, unknown, invalid and missing e-mails', distinct(free).length === 1, distinct(free).join(' | '));
  critical('taken subdomain: one identical response for every e-mail', distinct(taken).length === 1, distinct(taken).join(' | '));
  critical('responses carry subdomain availability only', JSON.parse(free[0].exchange.body).result?.subdomainAvailable === true
    && JSON.parse(taken[0].exchange.body).result?.subdomainAvailable === false && Object.keys(JSON.parse(free[0].exchange.body).result).length === 1);
}

const phases = { availability: availabilityPhase, signup: signupPhase, backend: backendPhase, 'resume-after-sale': resumeAfterSalePhase, finalize: finalizePhase, handover: handoverPhase, 'handed-over': handedOverPhase };
if (!phases[phase]) {
  console.error(`Unknown phase "${phase}". Use one of: ${Object.keys(phases).join(', ')}`);
  process.exit(1);
}
if (phase === 'handover') saveState({ ...loadState(), handoverIssuedAt: Date.now() });
try {
  await phases[phase]();
} catch (e) {
  console.error(`\nERROR (unexpected): ${e.code ?? ''} ${e.message} ${e.stack?.split('\n').slice(1, 3).join(' | ') ?? ''}`);
  process.exit(1);
}
console.log(`\n${phase}: ${failures ? `${failures} check(s) FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
