/**
 * Deploys production composite indexes onto the Phase I benchmark project via Admin REST.
 * Does not touch zelvoropos. Does not use `firebase deploy`.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertBenchProject, PROJECT_ID } from './phase-i-config.mjs';

assertBenchProject();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const spec = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8'));
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const headers = {
  Authorization: `Bearer ${token}`,
  'x-goog-user-project': PROJECT_ID,
  'Content-Type': 'application/json',
};

async function listIndexes() {
  const all = [];
  let pageToken = '';
  do {
    const url = `${BASE}/collectionGroups/-/indexes${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers });
    const json = await res.json();
    if (!res.ok) throw new Error(`list indexes ${res.status} ${JSON.stringify(json)}`);
    all.push(...(json.indexes || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return all;
}

function collectionGroupOf(index) {
  if (index.collectionGroup) return index.collectionGroup;
  const part = String(index.name || '').split('/collectionGroups/')[1] || '';
  return part.split('/')[0] || '';
}

function keyOf(index) {
  const fields = (index.fields || [])
    .filter((f) => f.fieldPath !== '__name__')
    .map((f) => `${f.fieldPath}:${f.order || f.arrayConfig || ''}`)
    .join('|');
  return `${collectionGroupOf(index)}::${index.queryScope}::${fields}`;
}

function desired() {
  return spec.indexes.map((idx) => ({
    collectionGroup: idx.collectionGroup,
    queryScope: idx.queryScope,
    fields: idx.fields,
  }));
}

const existing = await listIndexes();
const have = new Set(existing.map(keyOf));
const created = [];
for (const index of desired()) {
  const k = keyOf(index);
  if (have.has(k)) continue;
  const res = await fetch(`${BASE}/collectionGroups/${index.collectionGroup}/indexes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ queryScope: index.queryScope, fields: index.fields }),
  });
  const json = await res.json();
  if (!res.ok && !String(json.error?.message || '').includes('already exists')) {
    throw new Error(`create ${index.collectionGroup} ${res.status} ${JSON.stringify(json)}`);
  }
  created.push({ collectionGroup: index.collectionGroup, op: json.name || 'exists' });
}

let ready = false;
let listed = [];
for (let i = 0; i < 60; i += 1) {
  listed = await listIndexes();
  const wanted = desired().map(keyOf);
  const byKey = new Map(listed.map((idx) => [keyOf(idx), idx]));
  const missing = wanted.filter((k) => !byKey.has(k));
  const building = wanted.filter((k) => byKey.get(k)?.state && byKey.get(k).state !== 'READY');
  console.info(JSON.stringify({ pass: i, existing: listed.length, created: created.length, missing: missing.length, building: building.length }));
  if (!missing.length && !building.length) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}

console.info(
  JSON.stringify({
    project: PROJECT_ID,
    ready,
    states: listed.map((idx) => ({ collectionGroup: collectionGroupOf(idx), state: idx.state, fields: (idx.fields || []).map((f) => f.fieldPath) })),
  }),
);
if (!ready) process.exit(1);
