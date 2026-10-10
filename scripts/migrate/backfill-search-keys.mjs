#!/usr/bin/env node
/**
 * Production search-key backfill for ZELVERO POS.
 *
 * Writes ONLY:
 *   products:  nameNormalized
 *   customers: nameNormalized, phoneKey, emailKey
 *   suppliers: nameNormalized, phoneKey, emailKey
 *
 * Never writes stock, prices, debt, balances, sales, or document ids.
 * Dry-run is the default. Production writes require both --project=zelvoropos and
 * --production-confirm=zelvoropos plus --apply.
 *
 *   node scripts/migrate/backfill-search-keys.mjs --project=zelvoropos
 *   node scripts/migrate/backfill-search-keys.mjs --project=zelvoropos --tenant=<id>
 *   node scripts/migrate/backfill-search-keys.mjs --project=zelvoropos --production-confirm=zelvoropos --apply
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFirebaseTargets } from '../firebase-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED_PROJECT = 'zelvoropos';
const PAGE = 400;
const CHECKPOINT = join(ROOT, '.migrate', 'search-keys-checkpoint.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const eq = a.indexOf('=');
    if (eq === -1) return [a.replace(/^--/, ''), true];
    return [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const project = String(args.project || '');
const tenantFilter = args.tenant ? String(args.tenant) : '';
const apply = args.apply === true;
const confirm = String(args['production-confirm'] || '');
const resume = args.resume !== false && args.resume !== 'false';

if (project !== ALLOWED_PROJECT) {
  console.error('refusing: --project must be zelvoropos');
  process.exit(1);
}
const { problems, active } = checkFirebaseTargets({ projectFromCli: project });
if (problems.length || active !== ALLOWED_PROJECT) {
  console.error('Blocked by the Firebase isolation guard:', problems.join('; ') || `${active} is not ${ALLOWED_PROJECT}`);
  process.exit(1);
}
if (apply && confirm !== ALLOWED_PROJECT) {
  console.error('refusing writes: pass --production-confirm=zelvoropos with --apply');
  process.exit(1);
}

function nameNormalized(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}
function phoneKey(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 40);
}
function emailKey(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 200);
}

function assertSearchKeySource() {
  const src = readFileSync(join(ROOT, 'src/domain/searchKey.ts'), 'utf8');
  const generatedPath = join(ROOT, 'functions/src/shared/searchKey.ts');
  if (existsSync(generatedPath)) {
    const generated = readFileSync(generatedPath, 'utf8').replace(/^\/\/ GENERATED.*\n/, '');
    if (src !== generated) {
      console.error('STOP: src/domain/searchKey.ts does not match functions/src/shared/searchKey.ts');
      process.exit(1);
    }
  }
  const expect = [
    [nameNormalized('  Phone   Case '), 'phone case'],
    [nameNormalized('أإآ'), 'ااا'],
    [nameNormalized('مَدرسة'), 'مدرسه'],
    [phoneKey('  70-111-001  '), '70111001'],
    [emailKey('  A.B@X.COM  '), 'a.b@x.com'],
  ];
  const bad = expect.find(([got, want]) => got !== want);
  if (bad) {
    console.error('STOP: search-key helper does not match app normalization');
    process.exit(1);
  }
}

assertSearchKeySource();

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const headers = {
  Authorization: `Bearer ${token}`,
  'x-goog-user-project': project,
  'Content-Type': 'application/json',
};
const FS = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function req(url, { method = 'GET', body, attempt = 0 } = {}) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await sleep(500 * 2 ** attempt);
    return req(url, { method, body, attempt: attempt + 1 });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json.error || json)}`);
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

async function listCollection(parent, pageToken = '') {
  const q = new URLSearchParams({ pageSize: String(PAGE), orderBy: '__name__' });
  if (pageToken) q.set('pageToken', pageToken);
  const url = parent ? `${FS}/${parent}?${q}` : `${FS}?${q}`;
  return req(url);
}

function keysFor(collectionName, data) {
  if (typeof data.name !== 'string' || !data.name.trim()) return { malformed: true, next: null };
  const next = { nameNormalized: nameNormalized(data.name) };
  if (collectionName !== 'products') {
    if (!('phone' in data) || !('email' in data)) return { malformed: true, next: null };
    if (typeof data.phone !== 'string' || typeof data.email !== 'string') return { malformed: true, next: null };
    next.phoneKey = phoneKey(data.phone);
    next.emailKey = emailKey(data.email);
  }
  return { malformed: false, next };
}

function sameKeys(data, next) {
  return Object.entries(next).every(([k, v]) => data[k] === v);
}

function emptyStats() {
  return { scanned: 0, wouldUpdate: 0, updated: 0, skipped: 0, malformed: 0 };
}

function loadCheckpoint() {
  if (!resume || !existsSync(CHECKPOINT)) return { tenantsDone: [], collection: '', pageToken: '', statsByTenant: {} };
  return JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
}

function saveCheckpoint(state) {
  mkdirSync(dirname(CHECKPOINT), { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
}

function stringField(v) {
  return { stringValue: v };
}

async function commitUpdates(docs) {
  if (!docs.length) return;
  await req(`${FS.replace('/documents', '')}/documents:commit`, {
    method: 'POST',
    body: {
      writes: docs.map(({ name, next }) => ({
        update: {
          name,
          fields: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, stringField(v)])),
        },
        updateMask: { fieldPaths: Object.keys(next) },
        currentDocument: { exists: true },
      })),
    },
  });
}

const COLLECTIONS = ['products', 'customers', 'suppliers'];
const checkpoint = loadCheckpoint();
const report = {
  project,
  mode: apply ? 'apply' : 'dry-run',
  tenants: {},
  samples: { compared: 0, mismatch: 0, arabicFolded: 0, spacesCollapsed: 0, emailLowercased: 0, phoneDigits: 0 },
};

async function listTop(collectionId) {
  const out = [];
  let pageToken = '';
  do {
    const page = await listCollection(collectionId, pageToken);
    for (const doc of page.documents ?? []) {
      out.push({ id: doc.name.split('/').pop(), data: fields(doc.fields), name: doc.name });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

const stores = await listTop('stores');
const storeByTenant = Object.fromEntries(stores.map((s) => [s.id, { subdomain: s.data.subdomain || '', storeName: s.data.storeName || '' }]));
let tenants = (await listTop('tenants')).map((t) => t.id);
if (tenantFilter) {
  if (!tenants.includes(tenantFilter)) {
    console.error('unknown tenant', tenantFilter);
    process.exit(1);
  }
  tenants = [tenantFilter];
}

const skipTenants = new Set(checkpoint.tenantsDone || []);

for (const tenantId of tenants) {
  if (skipTenants.has(tenantId) && !tenantFilter) continue;
  const label = storeByTenant[tenantId] || { subdomain: '', storeName: '' };
  const tenantStats = checkpoint.statsByTenant[tenantId] || Object.fromEntries(COLLECTIONS.map((c) => [c, emptyStats()]));
  for (const collectionName of COLLECTIONS) {
    let pageToken = '';
    if (checkpoint.tenant === tenantId && checkpoint.collection === collectionName) pageToken = checkpoint.pageToken || '';
    else if (checkpoint.tenant === tenantId && COLLECTIONS.indexOf(checkpoint.collection) > COLLECTIONS.indexOf(collectionName)) continue;
    for (;;) {
      const page = await listCollection(`tenants/${tenantId}/${collectionName}`, pageToken);
      const docs = page.documents ?? [];
      const writes = [];
      for (const doc of docs) {
        const data = fields(doc.fields);
        tenantStats[collectionName].scanned += 1;
        const { malformed, next } = keysFor(collectionName, data);
        if (malformed) {
          tenantStats[collectionName].malformed += 1;
          continue;
        }
        if (data.name.includes('  ') || data.name !== data.name.trim()) report.samples.spacesCollapsed += 1;
        if (/[أإآىة]/.test(data.name)) report.samples.arabicFolded += 1;
        if (collectionName !== 'products' && data.email && data.email !== data.email.trim().toLowerCase()) report.samples.emailLowercased += 1;
        if (collectionName !== 'products' && data.phone && /\D/.test(data.phone)) report.samples.phoneDigits += 1;
        const recomputed = nameNormalized(data.name);
        if (recomputed !== next.nameNormalized) report.samples.mismatch += 1;
        report.samples.compared += 1;
        if (sameKeys(data, next)) tenantStats[collectionName].skipped += 1;
        else {
          tenantStats[collectionName].wouldUpdate += 1;
          writes.push({ name: doc.name, next });
        }
      }
      if (apply && writes.length) {
        await commitUpdates(writes);
        tenantStats[collectionName].updated += writes.length;
      }
      pageToken = page.nextPageToken ?? '';
      checkpoint.tenant = tenantId;
      checkpoint.collection = collectionName;
      checkpoint.pageToken = pageToken;
      checkpoint.statsByTenant = { ...checkpoint.statsByTenant, [tenantId]: tenantStats };
      saveCheckpoint(checkpoint);
      if (!pageToken) break;
    }
  }
  checkpoint.tenantsDone = [...new Set([...(checkpoint.tenantsDone || []), tenantId])];
  checkpoint.tenant = '';
  checkpoint.collection = '';
  checkpoint.pageToken = '';
  saveCheckpoint(checkpoint);
  report.tenants[tenantId] = {
    subdomain: label.subdomain,
    note: label.subdomain === 'techstore01' ? 'production-store-not-test' : label.subdomain === 'zelvero-prod-test' ? 'TEST' : '',
    ...tenantStats,
  };
}

if (apply) {
  writeFileSync(CHECKPOINT, JSON.stringify({ ...checkpoint, completedAt: new Date().toISOString() }, null, 2));
}

console.log(JSON.stringify(report, null, 2));
