const admin = require('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'demo-pos' });
}

const firestore = admin.firestore();

function centsToUSD(cents) {
  return Number(cents) / 100;
}

async function saveTenantCashboxSummaryLive(uid, tenantId, summary) {
  const cd = summary || {};
  const toUSDCents = (v) => Math.round((Number(v) || 0) * 100);
  const toLBPUnits = (v) => Math.round(Number(v) || 0);
  const fromUSDCents = (v) => (Number(v) || 0) / 100;

  const targetUSDCents = toUSDCents(cd.cashUSD);
  const targetLBPUnits = toLBPUnits(cd.cashLBP);
  const baseUSDCents = Number.isFinite(Number(cd.baseCashUSDCents))
    ? Number(cd.baseCashUSDCents)
    : null;
  const baseLBPUnits = Number.isFinite(Number(cd.baseCashLBPUnits))
    ? Number(cd.baseCashLBPUnits)
    : null;
  const operationIdRaw = String(cd.operationId || '').trim();
  const operationId = operationIdRaw ? operationIdRaw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) : null;

  const ref = firestore.collection('cashbox').doc(String(tenantId));
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() || {}) : {};
        const currentUSDCents = Number.isFinite(Number(data.cashUSDCents))
          ? Number(data.cashUSDCents)
          : Math.round((Number(data.cashUSD || 0) || 0) * 100);
        const currentLBPUnits = Number.isFinite(Number(data.cashLBPUnits))
          ? Number(data.cashLBPUnits)
          : Math.round(Number(data.cashLBP || 0) || 0);

        const recentOperationIds = Array.isArray(data.recentOperationIds) ? data.recentOperationIds : [];
        if (operationId && recentOperationIds.includes(operationId)) return;

        let nextUSDCents = targetUSDCents;
        let nextLBPUnits = targetLBPUnits;
        if (baseUSDCents !== null && baseLBPUnits !== null) {
          nextUSDCents = currentUSDCents + (targetUSDCents - baseUSDCents);
          nextLBPUnits = currentLBPUnits + (targetLBPUnits - baseLBPUnits);
        }

        tx.set(
          ref,
          {
            tenantId: String(tenantId),
            cashUSDCents: Math.round(nextUSDCents),
            cashLBPUnits: Math.round(nextLBPUnits),
            cashUSD: fromUSDCents(nextUSDCents),
            cashLBP: Math.round(nextLBPUnits),
            recentOperationIds: operationId
              ? [...recentOperationIds, operationId].slice(-200)
              : recentOperationIds,
            lastUpdate: cd.lastUpdate || new Date().toISOString(),
            updatedBy: uid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
      return;
    } catch (err) {
      const retriable = err && (err.code === 10 || err.code === 'aborted' || String(err.message || '').includes('ABORTED'));
      if (!retriable || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 40 * attempt));
    }
  }
}

async function readCashbox(tenantId) {
  const snap = await firestore.collection('cashbox').doc(tenantId).get();
  const d = snap.exists ? (snap.data() || {}) : {};
  return {
    cashUSDCents: Number(d.cashUSDCents || 0),
    cashLBPUnits: Number(d.cashLBPUnits || 0),
    recentOperationIds: Array.isArray(d.recentOperationIds) ? d.recentOperationIds : [],
  };
}

async function main() {
  const tenantId = `live-test-${Date.now()}`;
  const cashRef = firestore.collection('cashbox').doc(tenantId);
  await cashRef.delete().catch(() => {});

  const clientA = 'client-A';
  const clientB = 'client-B';

  let expectedCents = 0;
  let expectedLBP = 0;

  // Seed baseline
  await saveTenantCashboxSummaryLive(clientA, tenantId, {
    cashUSD: 0,
    cashLBP: 0,
    operationId: 'seed_0',
    lastUpdate: new Date().toISOString(),
  });

  // TC-LIVE-001: simultaneous sales (+10, +15 USD) from two clients.
  await Promise.all([
    saveTenantCashboxSummaryLive(clientA, tenantId, {
      cashUSD: centsToUSD(1000),
      cashLBP: 0,
      baseCashUSDCents: 0,
      baseCashLBPUnits: 0,
      operationId: 'sale_A_1',
      lastUpdate: new Date().toISOString(),
    }),
    saveTenantCashboxSummaryLive(clientB, tenantId, {
      cashUSD: centsToUSD(1500),
      cashLBP: 0,
      baseCashUSDCents: 0,
      baseCashLBPUnits: 0,
      operationId: 'sale_B_1',
      lastUpdate: new Date().toISOString(),
    }),
  ]);
  expectedCents += 1000 + 1500;

  const afterSales = await readCashbox(tenantId);

  // TC-LIVE-002: simultaneous returns (-500, -700 USD) from stale same base.
  await Promise.all([
    saveTenantCashboxSummaryLive(clientA, tenantId, {
      cashUSD: centsToUSD(expectedCents - 500),
      cashLBP: 0,
      baseCashUSDCents: expectedCents,
      baseCashLBPUnits: 0,
      operationId: 'ret_A_1',
      lastUpdate: new Date().toISOString(),
    }),
    saveTenantCashboxSummaryLive(clientB, tenantId, {
      cashUSD: centsToUSD(expectedCents - 700),
      cashLBP: 0,
      baseCashUSDCents: expectedCents,
      baseCashLBPUnits: 0,
      operationId: 'ret_B_1',
      lastUpdate: new Date().toISOString(),
    }),
  ]);
  expectedCents += -500 + -700;

  const afterReturns = await readCashbox(tenantId);

  // TC-LIVE-003: mixed operations under load (2 clients, 24 ops in concurrent batches).
  const loadOps = [];
  const deltas = [];
  for (let i = 0; i < 24; i++) {
    const isSale = i % 3 !== 0;
    const delta = isSale ? 125 : -80;
    deltas.push(delta);
    const actor = i % 2 === 0 ? clientA : clientB;
    const opId = `mix_${i}`;
    loadOps.push(() =>
      saveTenantCashboxSummaryLive(actor, tenantId, {
        cashUSD: centsToUSD(expectedCents + delta),
        cashLBP: expectedLBP,
        baseCashUSDCents: expectedCents,
        baseCashLBPUnits: expectedLBP,
        operationId: opId,
        lastUpdate: new Date().toISOString(),
      })
    );
  }
  const batchSize = 6;
  for (let i = 0; i < loadOps.length; i += batchSize) {
    const batch = loadOps.slice(i, i + batchSize).map((fn) => fn());
    await Promise.all(batch);
  }
  expectedCents += deltas.reduce((a, b) => a + b, 0);

  const afterMixed = await readCashbox(tenantId);

  // Idempotency live check (retry same op)
  const beforeRetry = afterMixed.cashUSDCents;
  await saveTenantCashboxSummaryLive(clientA, tenantId, {
    cashUSD: centsToUSD(expectedCents + 999),
    cashLBP: expectedLBP,
    baseCashUSDCents: expectedCents,
    baseCashLBPUnits: expectedLBP,
    operationId: 'mix_10', // existing op id
    lastUpdate: new Date().toISOString(),
  });
  const afterRetry = await readCashbox(tenantId);

  const report = {
    tenantId,
    tc_live_001_simultaneous_sales: {
      expected_cashUSDCents: 2500,
      actual_cashUSDCents: afterSales.cashUSDCents,
      pass: afterSales.cashUSDCents === 2500,
    },
    tc_live_002_simultaneous_returns: {
      expected_cashUSDCents: 1300,
      actual_cashUSDCents: afterReturns.cashUSDCents,
      pass: afterReturns.cashUSDCents === 1300,
    },
    tc_live_003_mixed_under_load: {
      expected_cashUSDCents: expectedCents,
      actual_cashUSDCents: afterMixed.cashUSDCents,
      pass: afterMixed.cashUSDCents === expectedCents,
      total_ops: 24,
    },
    tc_live_004_idempotency_retry: {
      expected_unchanged_cashUSDCents: beforeRetry,
      actual_cashUSDCents: afterRetry.cashUSDCents,
      pass: afterRetry.cashUSDCents === beforeRetry,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
