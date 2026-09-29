const fs = require('fs');
const vm = require('vm');

class FakeDocSnapshot {
  constructor(path, data) {
    this.id = path.split('/').pop();
    this.exists = data != null;
    this._data = data ? JSON.parse(JSON.stringify(data)) : null;
  }
  data() {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
}

class FakeDB {
  constructor() {
    this.docs = new Map();
    this._txQueue = Promise.resolve();
  }

  collection(name) {
    return {
      doc: (id) => {
        const path = `${name}/${id}`;
        return {
          _path: path,
          get: async () => new FakeDocSnapshot(path, this.docs.get(path) || null),
          set: async (data, opts) => {
            const prev = this.docs.get(path) || {};
            const next = opts && opts.merge ? { ...prev, ...data } : { ...data };
            this.docs.set(path, next);
          },
        };
      },
    };
  }

  async runTransaction(fn) {
    let result;
    this._txQueue = this._txQueue.then(async () => {
      const pendingWrites = [];
      const tx = {
        get: async (ref) => new FakeDocSnapshot(ref._path, this.docs.get(ref._path) || null),
        set: (ref, data, opts) => pendingWrites.push({ ref, data, opts }),
      };
      result = await fn(tx);
      for (const w of pendingWrites) {
        const prev = this.docs.get(w.ref._path) || {};
        const next = w.opts && w.opts.merge ? { ...prev, ...w.data } : { ...w.data };
        this.docs.set(w.ref._path, next);
      }
    });
    await this._txQueue;
    return result;
  }
}

async function main() {
  const fakeDb = new FakeDB();
  const fakeAuth = { currentUser: { uid: 'tester' } };
  const src = fs.readFileSync('public/firebase-db.js', 'utf8');

  const sandbox = {
    window: { firebaseDb: fakeDb, firebaseAuth: fakeAuth },
    firebase: {
      firestore: {
        FieldValue: {
          serverTimestamp: () => '__SERVER_TIMESTAMP__',
        },
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const db = sandbox.window.firebaseDbInstance;
  if (!db) throw new Error('firebaseDbInstance was not initialized');
  const tenantId = 'owner-1';

  // Seed initial value: $100 and 0 LBP.
  await db.saveTenantCashboxSummary(tenantId, {
    cashUSD: 100,
    cashLBP: 0,
    lastUpdate: '2026-05-06T00:00:00.000Z',
  });

  // TC-CONC-001: two devices with same base apply opposite deltas concurrently.
  // Device A: +20 USD (target 120 from base 100)
  // Device B: -30 USD (target 70 from base 100)
  await Promise.all([
    db.saveTenantCashboxSummary(tenantId, {
      cashUSD: 120,
      cashLBP: 0,
      baseCashUSDCents: 10000,
      baseCashLBPUnits: 0,
      operationId: 'op_A_1',
      lastUpdate: '2026-05-06T00:00:01.000Z',
    }),
    db.saveTenantCashboxSummary(tenantId, {
      cashUSD: 70,
      cashLBP: 0,
      baseCashUSDCents: 10000,
      baseCashLBPUnits: 0,
      operationId: 'op_B_1',
      lastUpdate: '2026-05-06T00:00:01.100Z',
    }),
  ]);

  const afterConcurrent = fakeDb.docs.get(`cashbox/${tenantId}`);

  // TC-CONC-002: retry same operationId should be idempotent.
  const beforeRetryCents = afterConcurrent.cashUSDCents;
  await db.saveTenantCashboxSummary(tenantId, {
    cashUSD: 120,
    cashLBP: 0,
    baseCashUSDCents: 10000,
    baseCashLBPUnits: 0,
    operationId: 'op_A_1',
    lastUpdate: '2026-05-06T00:00:02.000Z',
  });
  const afterRetry = fakeDb.docs.get(`cashbox/${tenantId}`);

  // TC-MONEY-001: cents precision check.
  await db.saveTenantCashboxSummary(tenantId, {
    cashUSD: 90.01,
    cashLBP: 5,
    baseCashUSDCents: afterRetry.cashUSDCents,
    baseCashLBPUnits: afterRetry.cashLBPUnits,
    operationId: 'op_precise_1',
    lastUpdate: '2026-05-06T00:00:03.000Z',
  });
  const afterPrecision = fakeDb.docs.get(`cashbox/${tenantId}`);

  console.log(
    JSON.stringify(
      {
        tc_conc_001: {
          expected_cashUSDCents: 9000,
          actual_cashUSDCents: afterConcurrent.cashUSDCents,
          pass: afterConcurrent.cashUSDCents === 9000,
        },
        tc_conc_002: {
          expected_cashUSDCents_unchanged: beforeRetryCents,
          actual_cashUSDCents: afterRetry.cashUSDCents,
          pass: afterRetry.cashUSDCents === beforeRetryCents,
        },
        tc_money_001: {
          expected_cashUSDCents: 9001,
          actual_cashUSDCents: afterPrecision.cashUSDCents,
          expected_cashLBPUnits: 5,
          actual_cashLBPUnits: afterPrecision.cashLBPUnits,
          pass: afterPrecision.cashUSDCents === 9001 && afterPrecision.cashLBPUnits === 5,
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
