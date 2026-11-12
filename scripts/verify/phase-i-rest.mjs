import { execSync } from 'node:child_process';
import { assertBenchProject, PROJECT_ID } from './phase-i-config.mjs';

assertBenchProject();

let cachedToken = { value: '', at: 0 };
function accessToken(force = false) {
  if (!force && cachedToken.value && Date.now() - cachedToken.at < 20 * 60_000) return cachedToken.value;
  let lastError;
  for (let i = 0; i < 8; i += 1) {
    try {
      cachedToken = { value: execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(), at: Date.now() };
      return cachedToken.value;
    } catch (error) {
      lastError = error;
      if (cachedToken.value && Date.now() - cachedToken.at < 50 * 60_000) return cachedToken.value;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(30_000, 1_000 * 2 ** i));
    }
  }
  throw lastError;
}

export function headers() {
  return {
    Authorization: `Bearer ${accessToken()}`,
    'x-goog-user-project': PROJECT_ID,
    'Content-Type': 'application/json',
  };
}

export const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;

export function str(v) {
  return { stringValue: v };
}
export function int(v) {
  return { integerValue: String(v) };
}
export function bool(v) {
  return { booleanValue: v };
}
export function nullV() {
  return { nullValue: null };
}

export function encode(value) {
  if (value === null || value === undefined) return nullV();
  if (typeof value === 'string') return str(value);
  if (typeof value === 'boolean') return bool(value);
  if (typeof value === 'number' && Number.isInteger(value)) return int(value);
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])),
      },
    };
  }
  throw new Error(`cannot encode ${typeof value}`);
}

export function docName(path) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

function isTransientNetwork(error) {
  const code = error?.cause?.code || error?.code || '';
  const name = error?.name || '';
  return name === 'TimeoutError' || name === 'AbortError' || /ETIMEDOUT|ENETUNREACH|ECONNRESET|UND_ERR|fetch failed/i.test(String(code) + String(error?.message || ''));
}

export async function commit(writes, attempt = 0) {
  let res;
  try {
    res = await fetch(`${FS}/documents:commit`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ writes }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (isTransientNetwork(error) && attempt < 12) {
      await new Promise((r) => setTimeout(r, Math.min(60_000, 500 * 2 ** Math.min(attempt, 8))));
      return commit(writes, attempt + 1);
    }
    throw error;
  }
  if (res.status === 401 || res.status === 403) {
    accessToken(true);
    if (attempt >= 4) throw new Error(`commit ${res.status} after token refresh`);
    return commit(writes, attempt + 1);
  }
  if (res.status === 429 || res.status === 503 || res.status === 500) {
    if (attempt >= 8) throw new Error(`commit ${res.status} after retries`);
    await new Promise((r) => setTimeout(r, Math.min(30_000, 400 * 2 ** attempt)));
    return commit(writes, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`commit ${res.status} ${text.slice(0, 500)}`);
  }
  return res.json();
}

export async function countQuery(parentDoc, collectionId) {
  const res = await fetch(`${FS}/documents/${parentDoc}:runAggregationQuery`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId }] },
        aggregations: [{ alias: 'n', count: {} }],
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`count ${collectionId} ${res.status} ${JSON.stringify(json)}`);
  return Number(json[0].result.aggregateFields.n.integerValue);
}

export async function runQuery(parentDoc, structuredQuery) {
  const res = await fetch(`${FS}/documents/${parentDoc}:runQuery`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ structuredQuery }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`query ${res.status} ${JSON.stringify(json).slice(0, 500)}`);
  return Array.isArray(json) ? json.filter((row) => row.document) : [];
}

export function order(field, desc = true) {
  return { field: { fieldPath: field }, direction: desc ? 'DESCENDING' : 'ASCENDING' };
}

export function fieldFilter(field, op, value) {
  return { fieldFilter: { field: { fieldPath: field }, op, value } };
}
