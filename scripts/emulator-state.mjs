// Prints the authoritative server state of the demo store from the LOCAL Firestore emulator
// (sales, cash drawer, stock, sale counter, processed offline operations) for manual scenarios.
// Usage (emulators running): node scripts/emulator-state.mjs
const BASE = 'http://127.0.0.1:8080/v1/projects/demo-zelvero/databases/(default)/documents';
const T = 'demoStore';
const headers = { Authorization: 'Bearer owner' };

async function list(path) {
  const res = await fetch(`${BASE}/${path}?pageSize=300`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()).documents ?? [];
}
async function get(path) {
  const res = await fetch(`${BASE}/${path}`, { headers });
  return res.ok ? res.json() : null;
}
const val = (f) => (f ? (f.integerValue ?? f.stringValue ?? f.doubleValue ?? f.booleanValue ?? (f.nullValue === null ? null : f.nullValue)) : undefined);
const id = (d) => d.name.split('/').pop();

const sales = await list(`tenants/${T}/sales`);
const products = await list(`tenants/${T}/products`);
const drawer = await get(`tenants/${T}/cashbox/summary`);
const counter = await get(`tenants/${T}/counters/sales`);

console.log(
  JSON.stringify(
    {
      sales: sales.map((d) => ({ id: id(d), invoice: val(d.fields.invoiceNumber), by: val(d.fields.createdBy), offlineRef: val(d.fields.offlineRef), totalUsdCents: val(d.fields.totalUsdCents) })),
      drawerUsdCents: val(drawer?.fields?.usdCents),
      nextInvoice: val(counter?.fields?.nextId),
      stock: Object.fromEntries(products.map((d) => [id(d), val(d.fields.stock)])),
    },
    null,
    1,
  ),
);
