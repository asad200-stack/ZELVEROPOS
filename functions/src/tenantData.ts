import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, storage } from './admin.js';
import { BUSINESS_COLLECTIONS, REGION } from './config.js';
import { fail } from './errors.js';
import { requireLiveOwner } from './liveUser.js';
import { caller, parse } from './validate.js';

/**
 * Owner-only reset of the store's business data. Settings, Telegram credentials, users and the
 * subscription are kept; counters, the drawer and categories start from zero.
 */
export const clearTenantData = onCall({ region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const c = caller(request);
  const tenantId = await requireLiveOwner(c);
  const { confirm } = parse(z.object({ confirm: z.string() }), request.data);
  if (confirm !== 'DELETE') fail('invalid-argument', 'error.fn.confirmMismatch');

  const tenant = db.doc(`tenants/${tenantId}`);
  let deleted = 0;
  for (const name of BUSINESS_COLLECTIONS) {
    const writer = db.bulkWriter();
    writer.onWriteResult(() => {
      deleted += 1;
    });
    await db.recursiveDelete(tenant.collection(name), writer);
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(tenant.collection('counters').doc('sales'), { nextId: 1, updatedAt: now });
  batch.set(tenant.collection('counters').doc('purchases'), { nextId: 1, updatedAt: now });
  batch.set(tenant.collection('cashbox').doc('summary'), { usdCents: 0, lbp: 0, lastTxId: null, updatedAt: now });
  batch.set(tenant.collection('lists').doc('categories'), { names: [] });
  await batch.commit();

  try {
    await storage().deleteFiles({ prefix: `tenants/${tenantId}/products/` });
  } catch (e) {
    console.warn('[clearTenantData] storage cleanup failed', tenantId, e);
  }
  console.info('[clearTenantData]', tenantId, 'deleted', deleted, 'by', c.uid);
  return { deleted };
});
