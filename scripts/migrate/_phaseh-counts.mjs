import { execSync } from 'node:child_process';
const TEST = 'Q8Pvlwqk4LN2e9bK8sUMRiisdZ32';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'zelvoropos', 'Content-Type': 'application/json' };
const FS = 'https://firestore.googleapis.com/v1/projects/zelvoropos/databases/(default)/documents';
function val(v) {
  if (!v) return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) return fields(v.mapValue.fields);
  if ('timestampValue' in v) return v.timestampValue;
  return v;
}
const fields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));
async function get(path) {
  const res = await fetch(`${FS}/${path}`, { headers, signal: AbortSignal.timeout(30000) });
  const j = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return fields(j.fields);
}
async function count(col) {
  const res = await fetch(`${FS}/tenants/${TEST}:${'runAggregationQuery'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: col }] }, aggregations: [{ alias: 'n', count: {} }] } }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`count ${col} ${res.status} ${JSON.stringify(j.error)}`);
  return Number(j[0].result.aggregateFields.n.integerValue);
}
const cols = ['cashTransactions', 'customerLedger', 'stockMovements', 'sales', 'returns', 'purchases', 'supplierPayments', 'purchaseReturns', 'clientOps'];
const counts = {};
for (const c of cols) counts[c] = await count(c);
const [product, cash, customer, s1, s2, sub] = await Promise.all([
  get(`tenants/${TEST}/products/R19GAGtt23mZILjXGAeN`),
  get(`tenants/${TEST}/cashbox/summary`),
  get(`tenants/${TEST}/customers/MhoPDPLX4g27MLTwg38h`),
  get(`tenants/${TEST}/suppliers/4oI5ubnd7UJdww7EnB5m`),
  get(`tenants/${TEST}/suppliers/dlUUxocrSRKofzdUZI04`),
  get(`subscriptions/${TEST}`),
]);
console.log(JSON.stringify({
  money: { stock: product.stock, usd: cash.usdCents, lbp: cash.lbp, debt: customer.debtUsdCents, sup1: s1.balanceUsdCents, sup2: s2.balanceUsdCents },
  activated: sub.activated,
  counts,
}, null, 2));
