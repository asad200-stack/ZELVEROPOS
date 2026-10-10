/**
 * Backfill for records created before nameNormalized / phoneKey / emailKey existed.
 *
 * This script refuses every project except the local demo emulator. It is the procedure
 * that would later be run against a production database, as a paged admin job, after the
 * composite indexes in firestore.indexes.json are deployed. It is not run here against
 * production, and it does not deploy indexes.
 *
 * For each product, customer and supplier document:
 *   nameNormalized = lowercase, trim, collapse repeated spaces (see src/domain/searchKey.ts)
 *   phoneKey       = digits only, when the document has a phone
 *   emailKey       = trimmed lowercase email, when the document has an email
 * Documents that already have the same keys are skipped. Ordering and money fields are not changed.
 * Documents are read with orderBy(documentId) and startAfter, 400 at a time, so the job
 * does not load a collection into memory.
 *
 * Usage (emulators only): node scripts/verify/backfill-search-keys.mjs <tenantId>
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, limit, orderBy, query, startAfter, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const tenantId = process.argv[2];
if (!PROJECT_ID.startsWith('demo-') || !tenantId) throw new Error('refusing to backfill anything but a named tenant on demo-zelvero');

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

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: '127.0.0.1', port: 8080 },
});

const touched = { products: 0, customers: 0, suppliers: 0 };
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  for (const name of ['products', 'customers', 'suppliers']) {
    let cursor = null;
    for (;;) {
      const base = query(collection(db, `tenants/${tenantId}/${name}`), orderBy('__name__'), limit(400));
      const snap = await getDocs(cursor ? query(base, startAfter(cursor)) : base);
      if (snap.empty) break;
      const batch = writeBatch(db);
      let updates = 0;
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const next = { nameNormalized: nameNormalized(data.name) };
        if ('phone' in data) next.phoneKey = String(data.phone ?? '').replace(/\D/g, '').slice(0, 40);
        if ('email' in data) next.emailKey = String(data.email ?? '').trim().toLowerCase().slice(0, 200);
        const same = Object.entries(next).every(([key, value]) => data[key] === value);
        if (!same) {
          batch.update(docSnap.ref, next);
          updates += 1;
        }
      }
      if (updates) await batch.commit();
      touched[name] += updates;
      if (snap.size < 400) break;
      cursor = snap.docs.at(-1) ?? null;
    }
  }
});
await env.cleanup();
console.info(JSON.stringify({ tenantId, touched, project: PROJECT_ID }));
