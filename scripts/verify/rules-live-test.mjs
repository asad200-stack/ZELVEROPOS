#!/usr/bin/env node
/**
 * Evaluates the rules RELEASED on a real project against simulated requests through the Firebase
 * Rules test API (projects.test). Nothing is read from or written to the database.
 *   node scripts/verify/rules-live-test.mjs zelvoropos [firestore|storage]
 * Uses the gcloud user credentials of the operator.
 */
import { execSync } from 'node:child_process';
import { checkFirebaseTargets } from '../firebase-guard.mjs';

const project = process.argv[2];
const { problems, active } = checkFirebaseTargets();
if (problems.length || project !== active) {
  console.error('Blocked by the Firebase isolation guard:', problems.join('; ') || `${project} is not the configured project`);
  process.exit(1);
}

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const api = async (path, body) => {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json.error)}`);
  return json;
};

const DAY = 86_400_000;
const now = Date.now();
const claims = (over = {}) => ({
  uid: 'ownerA',
  token: { tenantId: 'A', role: 'owner', active: true, email_verified: true, subUntil: now + 30 * DAY, ...over },
});
const cashier = (perms) => ({ uid: 'cashierA', token: { ...claims().token, role: 'subUser', perms } });
const doc = (p) => `/databases/(default)/documents/${p}`;
const product = { name: 'P', category: '', barcode: '', prices: {}, costUsdCents: 100, imeiTracking: false, minStock: null,
  expiryDate: null, supplierName: '', stock: 5, imeis: [] };

const cases = [
  // [label, expectation, method, path, auth, newData, existingData]
  ['owner A reads own sale (control)', 'ALLOW', 'get', 'tenants/A/sales/s1', claims()],
  ['owner A edits own product name (control)', 'ALLOW', 'update', 'tenants/A/products/p1', claims(), { ...product, name: 'Q' }, product],
  ['owner A reads tenant B sale', 'DENY', 'get', 'tenants/B/sales/s1', claims()],
  ['owner A lists tenant B products', 'DENY', 'list', 'tenants/B/products', claims()],
  ['owner A reads tenant B cashbox', 'DENY', 'get', 'tenants/B/cashbox/main', claims()],
  ['owner A edits tenant B product', 'DENY', 'update', 'tenants/B/products/p1', claims(), { ...product, name: 'Q' }, product],
  ['owner A reads tenant B user profile', 'DENY', 'get', 'users/ownerB', claims(), null, { tenantId: 'B' }],
  ['owner A creates a sale', 'DENY', 'create', 'tenants/A/sales/s2', claims(), { totalUsdCents: 1 }],
  ['owner A updates the drawer', 'DENY', 'update', 'tenants/A/cashbox/main', claims(), { balanceUsdCents: 1 }, { balanceUsdCents: 0 }],
  ['owner A creates a stock movement', 'DENY', 'create', 'tenants/A/stockMovements/m1', claims(), { qty: 5 }],
  ['owner A creates a cash transaction', 'DENY', 'create', 'tenants/A/cashTransactions/c1', claims(), { amountUsdCents: 5 }],
  ['owner A writes dailyStats', 'DENY', 'create', 'tenants/A/dailyStats/2026-10-01', claims(), { salesUsdCents: 5 }],
  ['owner A writes a counter', 'DENY', 'update', 'tenants/A/counters/invoice', claims(), { next: 1 }, { next: 9 }],
  ['owner A changes product stock', 'DENY', 'update', 'tenants/A/products/p1', claims(), { ...product, stock: 500 }, product],
  ['owner A creates a product directly', 'DENY', 'create', 'tenants/A/products/p2', claims(), product],
  ['owner A sets customer debt', 'DENY', 'update', 'tenants/A/customers/c1', claims(),
    { name: 'C', phone: '', email: '', address: '', creditLimitUsdCents: 0, debtUsdCents: 0 },
    { name: 'C', phone: '', email: '', address: '', creditLimitUsdCents: 0, debtUsdCents: 900 }],
  ['owner A writes own subscription', 'DENY', 'update', 'subscriptions/A', claims(), { until: now + 999 * DAY }, { until: now }],
  ['owner A changes own role', 'DENY', 'update', 'users/ownerA', claims(), { role: 'superAdmin', tenantId: 'A' }, { role: 'owner', tenantId: 'A' }],
  ['inactive owner reads own sale', 'DENY', 'get', 'tenants/A/sales/s1', claims({ active: false })],
  ['unverified owner reads own sale', 'DENY', 'get', 'tenants/A/sales/s1', claims({ email_verified: false })],
  ['expired subscription edits product', 'DENY', 'update', 'tenants/A/products/p1', claims({ subUntil: now - DAY }), { ...product, name: 'Q' }, product],
  ['cashier without canViewSales lists sales', 'DENY', 'list', 'tenants/A/sales', cashier({ canSell: true })],
  ['signed-in user without claims reads tenant', 'DENY', 'get', 'tenants/A', { uid: 'stranger', token: { email_verified: true } }],
  ['unauthenticated reads tenant', 'DENY', 'get', 'tenants/A', null],
];

const bucket = `${project}.firebasestorage.app`;
const obj = (p) => `/b/${bucket}/o/${p}`;
const image = (size, contentType = 'image/png') => ({ size, contentType, name: 'x', bucket });
const MB = 1024 * 1024;

const storageCases = [
  // [label, expectation, method, path, auth, newObject]
  ['owner A uploads own product image (control)', 'ALLOW', 'create', 'tenants/A/products/p1.png', claims(), image(50_000)],
  ['owner A reads own product image (control)', 'ALLOW', 'get', 'tenants/A/products/p1.png', claims()],
  ['unauthenticated upload', 'DENY', 'create', 'tenants/A/products/p1.png', null, image(50_000)],
  ['unauthenticated read', 'DENY', 'get', 'tenants/A/products/p1.png', null],
  ['owner A uploads into tenant B', 'DENY', 'create', 'tenants/B/products/p1.png', claims(), image(50_000)],
  ['owner A reads tenant B image', 'DENY', 'get', 'tenants/B/products/p1.png', claims()],
  ['owner A uploads into tenant B logo', 'DENY', 'create', 'tenants/B/logo/logo.png', claims(), image(50_000)],
  ['unsupported type (svg)', 'DENY', 'create', 'tenants/A/products/p1.svg', claims(), image(5_000, 'image/svg+xml')],
  ['unsupported type (html)', 'DENY', 'create', 'tenants/A/products/p1.html', claims(), image(5_000, 'text/html')],
  ['unsupported type (pdf)', 'DENY', 'create', 'tenants/A/products/p1.pdf', claims(), image(5_000, 'application/pdf')],
  ['file over 2 MB', 'DENY', 'create', 'tenants/A/products/big.png', claims(), image(2 * MB + 1)],
  ['exactly 2 MB (limit, control)', 'ALLOW', 'create', 'tenants/A/products/edge.png', claims(), image(2 * MB)],
  ['cashier without product permission uploads', 'DENY', 'create', 'tenants/A/products/p1.png', cashier({ canSell: true }), image(50_000)],
  ['expired subscription uploads', 'DENY', 'create', 'tenants/A/products/p1.png', claims({ subUntil: now - DAY }), image(50_000)],
  ['upload outside tenant paths', 'DENY', 'create', 'public/x.png', claims(), image(50_000)],
];

const service = process.argv[3] === 'storage' ? 'storage' : 'firestore';
const releaseName = service === 'storage' ? `firebase.storage/${bucket}` : 'cloud.firestore';
const selected = service === 'storage' ? storageCases : cases;
const toPath = service === 'storage' ? obj : doc;

const release = await api(`projects/${project}/releases/${releaseName}`);
const ruleset = await api(release.rulesetName);
const testCases = selected.map(([, expectation, method, path, auth, data, existing]) => ({
  expectation,
  request: {
    method, path: toPath(path), time: new Date(now).toISOString(), ...(auth && { auth }),
    ...(data && { resource: service === 'storage' ? data : { data } }),
  },
  ...(existing && { resource: { data: existing } }),
}));
const { testResults } = await api(`projects/${project}:test`, { source: ruleset.source, testSuite: { testCases } });

let failed = 0;
testResults.forEach((r, i) => {
  const ok = r.state === 'SUCCESS';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${selected[i][1].padEnd(5)} ${selected[i][0]}${ok ? '' : '  ' + JSON.stringify(r.debugMessages ?? r.errorPosition ?? r)}`);
});
console.log(`\n${service} ruleset ${release.rulesetName.split('/').pop()}: ${testResults.length - failed}/${testResults.length} passed`);
process.exit(failed ? 1 : 0);
