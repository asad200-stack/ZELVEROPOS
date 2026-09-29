const fs = require('fs');
const vm = require('vm');

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadRollbackFunctions() {
  const src = fs.readFileSync('public/script.js', 'utf8');
  const start = src.indexOf('function applySaleStockDeduction');
  const end = src.indexOf('function togglePriceEdit');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate rollback function block in public/script.js');
  }
  return src.slice(start, end);
}

function loadSecureSaveSaleFunction() {
  const src = fs.readFileSync('public/script.js', 'utf8');
  const start = src.indexOf('async function secureSaveSale');
  const end = src.indexOf('function getCurrentSales()');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate secureSaveSale block in public/script.js');
  }
  return src.slice(start, end);
}

function createSandbox() {
  const storage = new Map();
  const syncOps = [];
  const stockMovements = [];
  const sandbox = {
    console,
    products: [],
    customers: [],
    __syncOps: syncOps,
    __stockMovementsSink: stockMovements,
    getCurrentProducts() {
      return sandbox.products;
    },
    validateCartStockAvailability(cartItems) {
      const grouped = {};
      (Array.isArray(cartItems) ? cartItems : []).forEach((item) => {
        if (!item || item.type === 'previous_account') return;
        const key = String(item.id);
        grouped[key] = (grouped[key] || 0) + Math.max(0, Number(item.quantity) || 0);
      });
      for (const [id, qty] of Object.entries(grouped)) {
        const p = sandbox.products.find((x) => String(x.id) === String(id));
        if (!p || Number(p.stock || 0) < qty) {
          return { ok: false, message: `Insufficient stock for ${id}` };
        }
      }
      return { ok: true };
    },
    touchProductClientTimestamp(product) {
      product.clientUpdatedAt = Date.now();
    },
    recordStockMovement(type, productId, qty, invoice, note) {
      const cur = storage.get('stockMovements') || [];
      const entry = { type, productId, qty, invoice, note };
      cur.push(entry);
      storage.set('stockMovements', cur);
      stockMovements.push(entry);
    },
    saveToStorage(key, value) {
      storage.set(String(key), deepClone(value));
    },
    loadFromStorage(key, fallback) {
      const v = storage.get(String(key));
      return v == null ? deepClone(fallback) : deepClone(v);
    },
    enqueueSyncOp(entity, op, id, payload) {
      syncOps.push({ entity, op, id, payload: deepClone(payload) });
    },
    scheduleSyncFlush() {},
  };

  vm.createContext(sandbox);
  vm.runInContext(loadRollbackFunctions(), sandbox);
  return { sandbox, storage, syncOps, stockMovements };
}

function runR1() {
  const { sandbox, storage } = createSandbox();
  sandbox.products = [
    { id: 101, name: 'iPhone 14', stock: 5, imeiTracking: false },
    { id: 102, name: 'AirPods', stock: 10, imeiTracking: false },
  ];
  storage.set('stockMovements', []);

  const cart = [{ id: 101, name: 'iPhone 14', quantity: 2 }];
  const before = {
    products: deepClone(sandbox.products),
    stockMovements: deepClone(storage.get('stockMovements')),
  };

  const productSnapshots = sandbox.captureProductSnapshotsForCart(cart);
  const stockSnapshot = sandbox.captureStockMovementsSnapshot();
  const applyRes = sandbox.applySaleStockDeduction(cart, 'R1 test');

  // Inject failure after deduction stage.
  const injectedError = new Error('Injected save failure after stock mutation');
  if (injectedError) {
    sandbox.restoreProductSnapshots(productSnapshots);
    sandbox.restoreStockMovementsSnapshot(stockSnapshot);
  }

  const after = {
    products: deepClone(sandbox.products),
    stockMovements: deepClone(storage.get('stockMovements')),
  };

  return {
    id: 'R1',
    pass: applyRes.ok === true && deepEqual(before, after),
    applyRes,
    before,
    after,
    mismatch: deepEqual(before, after) ? null : 'State after rollback differs from pre-state',
  };
}

function runR2() {
  const { sandbox, storage } = createSandbox();
  sandbox.products = [{ id: 201, name: 'Galaxy S24', stock: 4, imeiTracking: false }];
  sandbox.customers = [{ id: 1, name: 'Customer A', creditBalance: 120, currentDebt: 120 }];
  storage.set('stockMovements', []);
  storage.set('customers', deepClone(sandbox.customers));

  const cart = [{ id: 201, name: 'Galaxy S24', quantity: 1 }];
  const customerSnapshot = sandbox.cloneForRollback(sandbox.customers[0]);
  const before = {
    products: deepClone(sandbox.products),
    stockMovements: deepClone(storage.get('stockMovements')),
    customer: deepClone(sandbox.customers[0]),
  };

  const productSnapshots = sandbox.captureProductSnapshotsForCart(cart);
  const stockSnapshot = sandbox.captureStockMovementsSnapshot();
  const applyRes = sandbox.applySaleStockDeduction(cart, 'R2 test');

  // Simulate in-flight partial mutation
  sandbox.customers[0].creditBalance = 180;
  sandbox.customers[0].currentDebt = 180;
  sandbox.saveToStorage('customers', sandbox.customers);

  // Inject failure and execute rollback sequence used by payment flow.
  const injectedError = new Error('Injected partial payment persistence failure');
  if (injectedError) {
    sandbox.restoreProductSnapshots(productSnapshots);
    sandbox.restoreStockMovementsSnapshot(stockSnapshot);
    sandbox.restoreCustomerSnapshot(customerSnapshot);
  }

  const after = {
    products: deepClone(sandbox.products),
    stockMovements: deepClone(storage.get('stockMovements')),
    customer: deepClone(sandbox.customers.find((c) => c.id === 1)),
  };

  return {
    id: 'R2',
    pass: applyRes.ok === true && deepEqual(before, after),
    applyRes,
    before,
    after,
    mismatch: deepEqual(before, after) ? null : 'State after rollback differs from pre-state',
  };
}

async function runR3() {
  const { sandbox, storage } = createSandbox();
  sandbox.products = [{ id: 301, name: 'Pixel 9', stock: 3, imeiTracking: false }];
  storage.set('stockMovements', []);
  storage.set('sales', []);

  const cart = [{ id: 301, name: 'Pixel 9', quantity: 1 }];
  const before = {
    products: deepClone(sandbox.products),
    stockMovements: deepClone(storage.get('stockMovements')),
    sales: deepClone(storage.get('sales')),
  };

  // processPayment-like rollback sequence for network interruption during finalization
  // (after stock deduction path, before durable sale finalize).
  const productSnapshots = sandbox.captureProductSnapshotsForCart(cart);
  const stockSnapshot = sandbox.captureStockMovementsSnapshot();
  const applyRes = sandbox.applySaleStockDeduction(cart, 'R3 test');

  let sawNetworkFailure = false;
  try {
    // Simulate network interruption during save/finalization.
    throw new Error('network interrupted during finalization');
  } catch (e) {
    sawNetworkFailure = /network/i.test(String(e && e.message));
    sandbox.restoreProductSnapshots(productSnapshots);
    sandbox.restoreStockMovementsSnapshot(stockSnapshot);
  }

  const after = {
    products: deepClone(sandbox.products),
    stockMovements: deepClone(storage.get('stockMovements')),
    sales: deepClone(storage.get('sales')),
  };

  const noHalfSale = Array.isArray(after.sales) && after.sales.length === 0;
  const noOrphanStockDeduction = deepEqual(after.products, before.products) && deepEqual(after.stockMovements, before.stockMovements);

  return {
    id: 'R3',
    pass: applyRes.ok === true && sawNetworkFailure && noHalfSale && noOrphanStockDeduction,
    applyRes,
    sawNetworkFailure,
    noHalfSale,
    noOrphanStockDeduction,
    before,
    after,
    mismatch: (noHalfSale && noOrphanStockDeduction) ? null : 'Half-sale or orphan stock mutation detected after rollback',
  };
}

async function runR4() {
  const localStore = new Map();
  const syncOps = [];
  const sandbox = {
    console,
    sales: [],
    currentUser: { uid: 'tester-user' },
    __sqliteReady: false,
    __sqlite: null,
    window: {
      __firestoreRestricted: false,
      firebaseDbInstance: null,
    },
    localStorage: {
      getItem(key) {
        return localStore.has(key) ? localStore.get(key) : null;
      },
      setItem(key, value) {
        localStore.set(key, String(value));
      },
      removeItem(key) {
        localStore.delete(key);
      },
    },
    getEffectiveDataOwnerId() {
      return 'owner-r4';
    },
    isPosOfflineSyncMode() {
      return false;
    },
    allocateMonotonicLocalSaleId: async function allocateMonotonicLocalSaleId() {
      return 9991;
    },
    getLocalDateTimeISO() {
      return '2026-05-08T12:40:00.000';
    },
    getText() {
      return 'Regular Customer';
    },
    getCurrentUserId() {
      return 'tester-user';
    },
    loadFromStorage(key, fallback) {
      const raw = localStore.get(`storage:${key}`);
      if (raw == null) return deepClone(fallback);
      try {
        return JSON.parse(raw);
      } catch (_) {
        return deepClone(fallback);
      }
    },
    saveToStorage(key, value) {
      localStore.set(`storage:${key}`, JSON.stringify(value));
    },
    sqliteSaveSale() {},
    cloudEnabled() {
      return false;
    },
    cloudSaveSale() {},
    enqueueSyncOp: async function enqueueSyncOp(entity, op, id, payload) {
      syncOps.push({ entity, op, id, payload: deepClone(payload) });
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(loadSecureSaveSaleFunction(), sandbox);

  const key = 'R4_IDEMPOTENCY_KEY_001';
  const firstPayload = {
    id: 5001,
    invoiceNumber: 'INV-5001',
    amount: 650,
    paymentMethod: 'نقدي',
    items: [{ id: 11, name: 'iPhone', quantity: 1 }],
    timestamp: '2026-05-08T12:39:00.000',
    date: '2026-05-08',
  };
  const secondPayload = {
    id: 5001,
    invoiceNumber: 'INV-5001',
    amount: 650,
    paymentMethod: 'نقدي',
    items: [{ id: 11, name: 'iPhone', quantity: 1 }],
    timestamp: '2026-05-08T12:39:00.000',
    date: '2026-05-08',
  };

  const firstResult = await sandbox.secureSaveSale(deepClone(firstPayload), { idempotencyKey: key });
  const syncOpsAfterFirst = syncOps.length;
  const salesCountAfterFirst = sandbox.sales.length;

  // Retry pressure: same operation retried with identical idempotency key.
  const secondResult = await sandbox.secureSaveSale(deepClone(secondPayload), { idempotencyKey: key });
  const syncOpsAfterSecond = syncOps.length;
  const salesCountAfterSecond = sandbox.sales.length;

  const idempotencyMapRaw = sandbox.localStorage.getItem('pos.idempotency.sales.owner-r4');
  let idempotencyMap = {};
  try { idempotencyMap = idempotencyMapRaw ? JSON.parse(idempotencyMapRaw) : {}; } catch (_) {}
  const idempotencyRecord = idempotencyMap[key] || null;

  const noDuplicateSale = salesCountAfterSecond === salesCountAfterFirst && salesCountAfterSecond === 1;
  const noDuplicateSyncEnqueue = syncOpsAfterSecond === syncOpsAfterFirst && syncOpsAfterSecond === 1;
  const sameInvoiceIdentity = String(firstResult.invoiceNumber) === String(secondResult.invoiceNumber)
    && String(firstResult.id) === String(secondResult.id);
  const recordIsStored = !!(idempotencyRecord && String(idempotencyRecord.saleId) === '5001');

  return {
    id: 'R4',
    pass: noDuplicateSale && noDuplicateSyncEnqueue && sameInvoiceIdentity && recordIsStored,
    noDuplicateSale,
    noDuplicateSyncEnqueue,
    sameInvoiceIdentity,
    recordIsStored,
    firstRun: {
      salesCount: salesCountAfterFirst,
      syncOps: syncOpsAfterFirst,
      result: firstResult,
    },
    retryRun: {
      salesCount: salesCountAfterSecond,
      syncOps: syncOpsAfterSecond,
      result: secondResult,
    },
    idempotencyRecord,
    mismatch: (noDuplicateSale && noDuplicateSyncEnqueue && sameInvoiceIdentity && recordIsStored)
      ? null
      : 'Idempotency retry produced duplicate state or inconsistent identity',
  };
}

async function runR5() {
  const localStore = new Map();
  const syncOps = [];
  const sandbox = {
    console,
    sales: [],
    currentUser: { uid: 'tester-user' },
    __sqliteReady: false,
    __sqlite: null,
    window: {
      __firestoreRestricted: false,
      firebaseDbInstance: null,
    },
    localStorage: {
      getItem(key) {
        return localStore.has(key) ? localStore.get(key) : null;
      },
      setItem(key, value) {
        localStore.set(key, String(value));
      },
      removeItem(key) {
        localStore.delete(key);
      },
    },
    getEffectiveDataOwnerId() {
      return 'owner-r5';
    },
    isPosOfflineSyncMode() {
      return false;
    },
    allocateMonotonicLocalSaleId: async function allocateMonotonicLocalSaleId() {
      return 6001;
    },
    getLocalDateTimeISO() {
      return '2026-05-08T12:42:00.000';
    },
    getText() {
      return 'Regular Customer';
    },
    getCurrentUserId() {
      return 'tester-user';
    },
    loadFromStorage(key, fallback) {
      const raw = localStore.get(`storage:${key}`);
      if (raw == null) return deepClone(fallback);
      try {
        return JSON.parse(raw);
      } catch (_) {
        return deepClone(fallback);
      }
    },
    saveToStorage(key, value) {
      localStore.set(`storage:${key}`, JSON.stringify(value));
    },
    sqliteSaveSale() {},
    cloudEnabled() {
      return false;
    },
    cloudSaveSale() {},
    enqueueSyncOp: async function enqueueSyncOp(entity, op, id, payload) {
      syncOps.push({ entity, op, id, payload: deepClone(payload) });
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(loadSecureSaveSaleFunction(), sandbox);

  // Base entities that must remain unchanged by forced finalize failure.
  const baseProducts = [{ id: 41, name: 'Device X', stock: 8 }];
  const baseCustomers = [{ id: 7, name: 'Customer R5', creditBalance: 50, currentDebt: 50 }];
  const baseCashDrawer = { cashUSD: 200, cashLBP: 0 };
  localStore.set('storage:products', JSON.stringify(baseProducts));
  localStore.set('storage:customers', JSON.stringify(baseCustomers));
  localStore.set('storage:cashDrawer', JSON.stringify(baseCashDrawer));

  const key = 'R5_IDEMPOTENCY_KEY_001';
  const payload = {
    id: 6001,
    invoiceNumber: 'INV-6001',
    amount: 400,
    paymentMethod: 'نقدي',
    items: [{ id: 41, name: 'Device X', quantity: 1 }],
    timestamp: '2026-05-08T12:41:00.000',
    date: '2026-05-08',
  };

  // Phase A: save succeeds.
  const saved = await sandbox.secureSaveSale(deepClone(payload), { idempotencyKey: key });
  const snapshotAfterSave = {
    sales: deepClone(sandbox.sales),
    syncOps: deepClone(syncOps),
    products: sandbox.loadFromStorage('products', []),
    customers: sandbox.loadFromStorage('customers', []),
    cashDrawer: sandbox.loadFromStorage('cashDrawer', {}),
  };

  let forcedFinalizeErrorSeen = false;
  try {
    // Phase B: emulate exception after save, before finalize side-effects.
    throw new Error('forced exception after secureSaveSale before finalize');
  } catch (e) {
    forcedFinalizeErrorSeen = /forced exception/i.test(String(e && e.message));
  }

  // Retry same operation after forced failure.
  const retried = await sandbox.secureSaveSale(deepClone(payload), { idempotencyKey: key });
  const finalState = {
    sales: deepClone(sandbox.sales),
    syncOps: deepClone(syncOps),
    products: sandbox.loadFromStorage('products', []),
    customers: sandbox.loadFromStorage('customers', []),
    cashDrawer: sandbox.loadFromStorage('cashDrawer', {}),
  };

  const noExtraSideEffects = deepEqual(snapshotAfterSave.products, finalState.products)
    && deepEqual(snapshotAfterSave.customers, finalState.customers)
    && deepEqual(snapshotAfterSave.cashDrawer, finalState.cashDrawer);
  const noDoubleProcessing = finalState.sales.length === 1 && finalState.syncOps.length === 1;
  const consistentIdentity = String(saved.id) === String(retried.id)
    && String(saved.invoiceNumber) === String(retried.invoiceNumber);

  return {
    id: 'R5',
    pass: forcedFinalizeErrorSeen && noExtraSideEffects && noDoubleProcessing && consistentIdentity,
    forcedFinalizeErrorSeen,
    noExtraSideEffects,
    noDoubleProcessing,
    consistentIdentity,
    snapshotAfterSave,
    finalState,
    saved,
    retried,
    mismatch: (forcedFinalizeErrorSeen && noExtraSideEffects && noDoubleProcessing && consistentIdentity)
      ? null
      : 'Post-save forced exception caused side-effect drift or duplicate processing',
  };
}

async function main() {
  const r1 = runR1();
  const r2 = runR2();
  const r3 = await runR3();
  const r4 = await runR4();
  const r5 = await runR5();
  const report = {
    executedAt: new Date().toISOString(),
    overallPass: !!(r1.pass && r2.pass && r3.pass && r4.pass && r5.pass),
    results: [r1, r2, r3, r4, r5],
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.overallPass) process.exitCode = 1;
}

main();
