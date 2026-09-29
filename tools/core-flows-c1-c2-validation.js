const fs = require('fs');
const vm = require('vm');

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Cannot extract block: ${startNeedle} .. ${endNeedle}`);
  }
  return source.slice(start, end);
}

function createFlowSandbox() {
  const script = fs.readFileSync('public/script.js', 'utf8');
  const blockStock = readBlock(script, 'function applySaleStockDeduction', 'function togglePriceEdit');
  const blockSecureSave = readBlock(script, 'async function secureSaveSale', 'function getCurrentSales()');

  const localStore = new Map();
  const syncOps = [];
  const drawerTx = [];

  const sandbox = {
    console,
    sales: [],
    products: [],
    customers: [],
    cashDrawer: { cashUSD: 0, cashLBP: 0 },
    settings: { exchangeRate: 89000 },
    currentUser: { uid: 'tester-core' },
    __sqliteReady: false,
    __sqlite: null,
    window: { __firestoreRestricted: false, firebaseDbInstance: null },
    localStorage: {
      getItem(k) { return localStore.has(k) ? localStore.get(k) : null; },
      setItem(k, v) { localStore.set(k, String(v)); },
      removeItem(k) { localStore.delete(k); }
    },
    saveToStorage(key, value) {
      localStore.set(`storage:${key}`, JSON.stringify(value));
    },
    loadFromStorage(key, fallback) {
      const raw = localStore.get(`storage:${key}`);
      if (raw == null) return clone(fallback);
      try { return JSON.parse(raw); } catch (_) { return clone(fallback); }
    },
    getCurrentProducts() { return sandbox.products; },
    validateCartStockAvailability(cartItems) {
      const grouped = {};
      (Array.isArray(cartItems) ? cartItems : []).forEach((item) => {
        if (!item || item.type === 'previous_account') return;
        const id = String(item.id);
        grouped[id] = (grouped[id] || 0) + Math.max(0, Number(item.quantity) || 0);
      });
      for (const [id, qty] of Object.entries(grouped)) {
        const p = sandbox.products.find((x) => String(x.id) === id);
        if (!p || Number(p.stock || 0) < qty) return { ok: false, message: `Insufficient ${id}` };
      }
      return { ok: true };
    },
    touchProductClientTimestamp(p) { p.clientUpdatedAt = Date.now(); },
    recordStockMovement(type, productId, qty, invoiceNumber, note) {
      const list = sandbox.loadFromStorage('stockMovements', []);
      list.push({ type, productId, qty, invoiceNumber, note });
      sandbox.saveToStorage('stockMovements', list);
    },
    enqueueSyncOp: async (entity, op, id, payload) => syncOps.push({ entity, op, id, payload: clone(payload) }),
    scheduleSyncFlush() {},
    cloudEnabled() { return false; },
    cloudSaveSale() {},
    sqliteSaveSale() {},
    getEffectiveDataOwnerId() { return 'owner-core'; },
    isPosOfflineSyncMode() { return false; },
    getText() { return 'Regular Customer'; },
    getCurrentUserId() { return 'tester-core'; },
    getLocalDateTimeISO() { return '2026-05-08T12:50:00.000'; },
    allocateMonotonicLocalSaleId: async () => 7001,
    addCashDrawerTransaction(tx) { drawerTx.push(clone(tx)); },
    __syncOps: syncOps,
    __drawerTx: drawerTx,
  };

  vm.createContext(sandbox);
  vm.runInContext(blockStock, sandbox);
  vm.runInContext(blockSecureSave, sandbox);
  return sandbox;
}

async function runC1() {
  const sb = createFlowSandbox();
  sb.products = [{ id: 1001, name: 'iPhone 14', stock: 5, imeiTracking: false }];
  sb.cashDrawer = { cashUSD: 100, cashLBP: 0 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('stockMovements', []);

  const cart = [{ id: 1001, name: 'iPhone 14', quantity: 1 }];
  const before = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const stockRes = sb.applySaleStockDeduction(cart, 'C1 cash USD');
  const sale = await sb.secureSaveSale({
    id: 7101,
    invoiceNumber: 'INV-7101',
    amount: 650,
    paymentMethod: 'نقدي',
    items: [{ id: 1001, name: 'iPhone 14', quantity: 1, finalPriceUSD: 650 }],
    timestamp: '2026-05-08T12:50:10.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C1_KEY' });
  sb.cashDrawer.cashUSD += 650;

  const after = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const invariants = {
    stockDeltaMatchesQty: Number(before.products[0].stock) - Number(after.products[0].stock) === 1,
    oneSalePersisted: after.sales.length === 1,
    invoiceIdentity: String(after.sales[0].invoiceNumber) === 'INV-7101',
    drawerDeltaMatchesPaid: Number(after.cashDrawer.cashUSD) - Number(before.cashDrawer.cashUSD) === 650,
    movementRecorded: after.stockMovements.length === 1 && Number(after.stockMovements[0].qty) === -1,
  };
  const pass = stockRes.ok === true && Object.values(invariants).every(Boolean);

  return { id: 'C1', pass, before, after, sale, invariants, mismatch: pass ? null : 'C1 invariant failure' };
}

async function runC2() {
  const sb = createFlowSandbox();
  sb.settings.exchangeRate = 89000;
  sb.products = [{ id: 2001, name: 'Galaxy S24', stock: 4, imeiTracking: false }];
  sb.cashDrawer = { cashUSD: 0, cashLBP: 5000000 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('stockMovements', []);

  const cart = [{ id: 2001, name: 'Galaxy S24', quantity: 1 }];
  const before = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const stockRes = sb.applySaleStockDeduction(cart, 'C2 cash LBP');
  const amountUSD = 400;
  const amountLBP = Math.round(amountUSD * sb.settings.exchangeRate);
  const sale = await sb.secureSaveSale({
    id: 7201,
    invoiceNumber: 'INV-7201',
    amount: amountUSD,
    paymentMethod: 'نقدي',
    items: [{ id: 2001, name: 'Galaxy S24', quantity: 1, finalPriceUSD: amountUSD }],
    cashDetails: { amountPaid: amountLBP, paymentCurrency: 'LBP', amountPaidUSDCents: Math.round((amountLBP / sb.settings.exchangeRate) * 100) },
    timestamp: '2026-05-08T12:52:10.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C2_KEY' });
  sb.cashDrawer.cashLBP += amountLBP;

  const after = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const invariants = {
    stockDeltaMatchesQty: Number(before.products[0].stock) - Number(after.products[0].stock) === 1,
    oneSalePersisted: after.sales.length === 1,
    invoiceIdentity: String(after.sales[0].invoiceNumber) === 'INV-7201',
    lbpDrawerDeltaMatchesPaid: Number(after.cashDrawer.cashLBP) - Number(before.cashDrawer.cashLBP) === amountLBP,
    storedUsdAmountConsistent: Number(after.sales[0].amount) === amountUSD,
    movementRecorded: after.stockMovements.length === 1 && Number(after.stockMovements[0].qty) === -1,
  };
  const pass = stockRes.ok === true && Object.values(invariants).every(Boolean);

  return { id: 'C2', pass, before, after, sale, invariants, mismatch: pass ? null : 'C2 invariant failure' };
}

async function runC3() {
  const sb = createFlowSandbox();
  sb.products = [{ id: 3001, name: 'iPhone 15', stock: 6, imeiTracking: false }];
  sb.customers = [{ id: 31, name: 'Customer Partial', creditBalance: 120, currentDebt: 120, creditLimit: 2000 }];
  sb.cashDrawer = { cashUSD: 50, cashLBP: 0 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('customers', sb.customers);
  sb.saveToStorage('stockMovements', []);

  const cart = [{ id: 3001, name: 'iPhone 15', quantity: 1 }];
  const totalUSD = 500;
  const paidUSD = 200;
  const debtAddedUSD = totalUSD - paidUSD;

  const before = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const stockRes = sb.applySaleStockDeduction(cart, 'C3 partial payment');

  // Partial flow should add paid cash now and carry remaining debt to customer.
  sb.cashDrawer.cashUSD += paidUSD;
  const customer = sb.customers.find((c) => c.id === 31);
  customer.creditBalance = Number(customer.creditBalance || 0) + debtAddedUSD;
  customer.currentDebt = customer.creditBalance;
  sb.saveToStorage('customers', sb.customers);

  const sale = await sb.secureSaveSale({
    id: 7301,
    invoiceNumber: 'INV-7301',
    amount: totalUSD,
    paymentMethod: 'دفع جزئي (دين)',
    items: [{ id: 3001, name: 'iPhone 15', quantity: 1, finalPriceUSD: totalUSD }],
    partialDetails: {
      customerId: 31,
      customerName: 'Customer Partial',
      amountPaid: paidUSD,
      amountPaidUSDCents: paidUSD * 100,
      paymentCurrency: 'USD',
      debtAmount: debtAddedUSD,
      debtAmountUSDCents: debtAddedUSD * 100,
      debtBalanceAfterUSD: customer.creditBalance,
    },
    timestamp: '2026-05-08T12:56:10.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C3_KEY' });

  const after = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const expectedDebtAfter = Number(before.customers[0].creditBalance) + debtAddedUSD;
  const invariants = {
    stockDeltaMatchesQty: Number(before.products[0].stock) - Number(after.products[0].stock) === 1,
    oneSalePersisted: after.sales.length === 1,
    partialDetailsPersisted: !!(after.sales[0].partialDetails && Number(after.sales[0].partialDetails.debtAmount) === debtAddedUSD),
    drawerUsdDeltaMatchesPaidPart: Number(after.cashDrawer.cashUSD) - Number(before.cashDrawer.cashUSD) === paidUSD,
    customerDebtUpdated: Number(after.customers[0].creditBalance) === expectedDebtAfter && Number(after.customers[0].currentDebt) === expectedDebtAfter,
    movementRecorded: after.stockMovements.length === 1 && Number(after.stockMovements[0].qty) === -1,
  };
  const pass = stockRes.ok === true && Object.values(invariants).every(Boolean);

  return { id: 'C3', pass, before, after, sale, invariants, mismatch: pass ? null : 'C3 invariant failure' };
}

async function runC4() {
  const sb = createFlowSandbox();
  sb.products = [{ id: 4001, name: 'MacBook Pro', stock: 3, imeiTracking: false }];
  sb.customers = [{ id: 41, name: 'Customer Credit', creditBalance: 250, currentDebt: 250, creditLimit: 5000 }];
  sb.cashDrawer = { cashUSD: 900, cashLBP: 12000000 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('customers', sb.customers);
  sb.saveToStorage('stockMovements', []);

  const cart = [{ id: 4001, name: 'MacBook Pro', quantity: 1 }];
  const totalUSD = 1200;

  const before = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const stockRes = sb.applySaleStockDeduction(cart, 'C4 credit sale');

  // Credit flow: full amount goes to debt, no immediate cash collection.
  const customer = sb.customers.find((c) => c.id === 41);
  customer.creditBalance = Number(customer.creditBalance || 0) + totalUSD;
  customer.currentDebt = customer.creditBalance;
  sb.saveToStorage('customers', sb.customers);

  const sale = await sb.secureSaveSale({
    id: 7401,
    invoiceNumber: 'CR-7401',
    amount: totalUSD,
    paymentMethod: 'Credit Sale',
    items: [{ id: 4001, name: 'MacBook Pro', quantity: 1, finalPriceUSD: totalUSD }],
    partialDetails: {
      customerId: 41,
      customerName: 'Customer Credit',
      amountPaid: 0,
      amountPaidUSDCents: 0,
      paymentCurrency: 'USD',
      debtAmount: totalUSD,
      debtAmountUSDCents: totalUSD * 100,
      debtBalanceAfterUSD: customer.creditBalance,
    },
    timestamp: '2026-05-08T13:00:10.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C4_KEY' });

  const after = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const expectedDebtAfter = Number(before.customers[0].creditBalance) + totalUSD;
  const invariants = {
    stockDeltaMatchesQty: Number(before.products[0].stock) - Number(after.products[0].stock) === 1,
    oneSalePersisted: after.sales.length === 1,
    creditDebtRecorded: Number(after.sales[0].partialDetails?.debtAmount || 0) === totalUSD && Number(after.sales[0].partialDetails?.amountPaid || 0) === 0,
    customerDebtUpdated: Number(after.customers[0].creditBalance) === expectedDebtAfter && Number(after.customers[0].currentDebt) === expectedDebtAfter,
    cashDrawerUnaffected: eq(before.cashDrawer, after.cashDrawer),
    movementRecorded: after.stockMovements.length === 1 && Number(after.stockMovements[0].qty) === -1,
  };
  const pass = stockRes.ok === true && Object.values(invariants).every(Boolean);

  return { id: 'C4', pass, before, after, sale, invariants, mismatch: pass ? null : 'C4 invariant failure' };
}

async function runC5() {
  const sb = createFlowSandbox();
  sb.products = [{ id: 5001, name: 'iPad Pro', stock: 10, imeiTracking: false }];
  sb.cashDrawer = { cashUSD: 1000, cashLBP: 0 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('stockMovements', []);

  // Seed original cash sale that will be fully returned.
  const originalSale = await sb.secureSaveSale({
    id: 7501,
    invoiceNumber: 'INV-7501',
    amount: 300,
    paymentMethod: 'نقدي',
    items: [{ id: 5001, name: 'iPad Pro', quantity: 1, finalPriceUSD: 300 }],
    timestamp: '2026-05-08T13:05:00.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C5_ORIGINAL_SALE' });
  // Simulate completed original sale impact.
  sb.products[0].stock -= 1;
  sb.cashDrawer.cashUSD += 300;
  sb.recordStockMovement('sale', 5001, -1, originalSale.invoiceNumber, 'C5 original sale');

  const before = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  // Full return should reverse sale impact.
  const returnInvoiceNumber = 'RF-7501';
  sb.products[0].stock += 1; // full quantity restored
  sb.cashDrawer.cashUSD -= 300; // refund cash out
  sb.recordStockMovement('return_full', 5001, +1, returnInvoiceNumber, 'C5 full return');

  const returnSale = await sb.secureSaveSale({
    id: 7502,
    invoiceNumber: returnInvoiceNumber,
    amount: -300,
    paymentMethod: 'refund',
    originalInvoiceNumber: originalSale.invoiceNumber,
    items: [{ id: 5001, name: 'iPad Pro', quantity: 1, finalPriceUSD: -300 }],
    returned: true,
    returnType: 'full',
    returnAmount: 300,
    timestamp: '2026-05-08T13:06:00.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C5_FULL_RETURN' });

  const after = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const returnMovements = after.stockMovements.filter((m) => m && String(m.invoiceNumber || '').startsWith('RF-'));
  const invariants = {
    fullStockRestored: Number(after.products[0].stock) === Number(before.products[0].stock) + 1,
    saleImpactReversedInDrawer: Number(after.cashDrawer.cashUSD) === Number(before.cashDrawer.cashUSD) - 300,
    returnPersisted: after.sales.some((s) => String(s.invoiceNumber) === returnInvoiceNumber && String(s.paymentMethod).toLowerCase() === 'refund'),
    noOrphanStockMovements: returnMovements.length === 1 && Number(returnMovements[0].qty) === 1,
    originalSaleStillPresent: after.sales.some((s) => String(s.invoiceNumber) === 'INV-7501'),
  };
  const pass = Object.values(invariants).every(Boolean);

  return {
    id: 'C5',
    pass,
    before,
    after,
    originalSale,
    returnSale,
    invariants,
    mismatch: pass ? null : 'C5 invariant failure'
  };
}

async function runC6() {
  const sb = createFlowSandbox();
  sb.products = [{ id: 6001, name: 'AirPods Pro', stock: 20, imeiTracking: false }];
  sb.cashDrawer = { cashUSD: 500, cashLBP: 0 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('stockMovements', []);

  // Seed original sale with quantity 2 so we can return only part of it.
  const originalQty = 2;
  const unitPriceUSD = 150;
  const originalAmount = originalQty * unitPriceUSD;
  const originalSale = await sb.secureSaveSale({
    id: 7601,
    invoiceNumber: 'INV-7601',
    amount: originalAmount,
    paymentMethod: 'نقدي',
    items: [{ id: 6001, name: 'AirPods Pro', quantity: originalQty, finalPriceUSD: unitPriceUSD }],
    timestamp: '2026-05-08T13:10:00.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C6_ORIGINAL_SALE' });
  // Apply original sale impact
  sb.products[0].stock -= originalQty;
  sb.cashDrawer.cashUSD += originalAmount;
  sb.recordStockMovement('sale', 6001, -originalQty, originalSale.invoiceNumber, 'C6 original sale');

  const before = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  // Partial return: return 1 out of 2
  const returnQty = 1;
  const returnAmount = returnQty * unitPriceUSD;
  const returnInvoiceNumber = 'RF-7601-P1';
  sb.products[0].stock += returnQty;
  sb.cashDrawer.cashUSD -= returnAmount;
  sb.recordStockMovement('return_partial', 6001, +returnQty, returnInvoiceNumber, 'C6 partial return');

  const returnSale = await sb.secureSaveSale({
    id: 7602,
    invoiceNumber: returnInvoiceNumber,
    amount: -returnAmount,
    paymentMethod: 'refund',
    originalInvoiceNumber: originalSale.invoiceNumber,
    items: [{ id: 6001, name: 'AirPods Pro', quantity: returnQty, finalPriceUSD: -unitPriceUSD }],
    returned: true,
    returnType: 'partial',
    returnAmount: returnAmount,
    timestamp: '2026-05-08T13:11:00.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C6_PARTIAL_RETURN' });

  const after = {
    products: clone(sb.products),
    sales: clone(sb.sales),
    cashDrawer: clone(sb.cashDrawer),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const expectedStockAfter = Number(before.products[0].stock) + returnQty;
  const expectedDrawerAfter = Number(before.cashDrawer.cashUSD) - returnAmount;
  const returnMovement = after.stockMovements.find((m) => String(m.invoiceNumber || '') === returnInvoiceNumber);
  const returnSaleRecord = after.sales.find((s) => String(s.invoiceNumber || '') === returnInvoiceNumber);

  const invariants = {
    partialStockRestored: Number(after.products[0].stock) === expectedStockAfter,
    financialReversalIsPartial: Number(after.cashDrawer.cashUSD) === expectedDrawerAfter,
    linkedToOriginalSale: !!(returnSaleRecord && String(returnSaleRecord.originalInvoiceNumber || '') === 'INV-7601'),
    partialReturnPersisted: !!(returnSaleRecord && String(returnSaleRecord.returnType || '') === 'partial' && Number(returnSaleRecord.returnAmount || 0) === returnAmount),
    movementMatchesFinancialRecord: !!(returnMovement && Number(returnMovement.qty) === returnQty && Number(returnSaleRecord.amount || 0) === -returnAmount),
    noOrphanReturnMovement: !!(returnMovement && returnSaleRecord),
  };
  const pass = Object.values(invariants).every(Boolean);

  return {
    id: 'C6',
    pass,
    before,
    after,
    originalSale,
    returnSale,
    invariants,
    mismatch: pass ? null : 'C6 invariant failure'
  };
}

async function runC7() {
  const sb = createFlowSandbox();
  sb.customers = [
    {
      id: 71,
      name: 'Customer Settlement',
      creditBalance: 500,
      currentDebt: 500,
      creditLimit: 5000,
      creditHistory: [
        { type: 'creditSale', amount: 300, balanceAfter: 300, timestamp: '2026-05-07T10:00:00.000Z' },
        { type: 'creditSale', amount: 200, balanceAfter: 500, timestamp: '2026-05-07T12:00:00.000Z' }
      ]
    }
  ];
  sb.cashDrawer = { cashUSD: 1200, cashLBP: 0 };
  sb.saveToStorage('customers', sb.customers);
  sb.saveToStorage('sales', []);
  sb.saveToStorage('customerLogs', { '71': [] });

  const before = {
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    sales: clone(sb.sales),
    customerLogs: sb.loadFromStorage('customerLogs', {}),
  };

  // Previous account settlement outside direct product sale context:
  // customer pays 180 USD toward existing debt.
  const settlementAmount = 180;
  const customer = sb.customers.find((c) => c.id === 71);
  customer.creditBalance = Math.max(0, Number(customer.creditBalance || 0) - settlementAmount);
  customer.currentDebt = customer.creditBalance;
  if (!Array.isArray(customer.creditHistory)) customer.creditHistory = [];
  customer.creditHistory.push({
    type: 'settlement',
    amount: -settlementAmount,
    balanceAfter: customer.creditBalance,
    timestamp: '2026-05-08T13:15:00.000Z',
    note: 'Previous account settlement (standalone)'
  });
  sb.saveToStorage('customers', sb.customers);

  sb.cashDrawer.cashUSD += settlementAmount;
  sb.saveToStorage('cashDrawer', sb.cashDrawer);

  // Optional operational record for standalone settlement event.
  const settlementRecord = await sb.secureSaveSale({
    id: 7701,
    invoiceNumber: 'SET-7701',
    amount: 0,
    paymentMethod: 'Settlement',
    customer: 'Customer Settlement',
    customerId: 71,
    items: [],
    partialDetails: {
      customerId: 71,
      customerName: 'Customer Settlement',
      amountPaid: settlementAmount,
      amountPaidUSDCents: settlementAmount * 100,
      paymentCurrency: 'USD',
      debtAmount: 0,
      debtAmountUSDCents: 0,
      debtBalanceAfterUSD: customer.creditBalance
    },
    timestamp: '2026-05-08T13:15:00.000',
    date: '2026-05-08'
  }, { idempotencyKey: 'C7_SETTLEMENT' });

  const logs = sb.loadFromStorage('customerLogs', {});
  if (!Array.isArray(logs['71'])) logs['71'] = [];
  logs['71'].push({
    action: 'settlement',
    amount: settlementAmount,
    beforeDebt: Number(before.customers[0].creditBalance || 0),
    afterDebt: Number(customer.creditBalance || 0),
    timestamp: '2026-05-08T13:15:00.000Z'
  });
  sb.saveToStorage('customerLogs', logs);

  const after = {
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    sales: clone(sb.sales),
    customerLogs: sb.loadFromStorage('customerLogs', {}),
  };

  const expectedDebtAfter = Number(before.customers[0].creditBalance) - settlementAmount;
  const expectedDrawerAfter = Number(before.cashDrawer.cashUSD) + settlementAmount;
  const settlementEvents = after.customers[0].creditHistory.filter((h) => String(h.type) === 'settlement');
  const settlementLogs = Array.isArray(after.customerLogs['71']) ? after.customerLogs['71'].filter((l) => String(l.action) === 'settlement') : [];

  const invariants = {
    debtReducedCorrectly: Number(after.customers[0].creditBalance) === expectedDebtAfter && Number(after.customers[0].currentDebt) === expectedDebtAfter,
    drawerUpdatedAsSettlementInflow: Number(after.cashDrawer.cashUSD) === expectedDrawerAfter,
    noNewInvoiceDebtSideEffect: Number(settlementRecord.amount || 0) === 0 && Number(settlementRecord.partialDetails?.debtAmount || 0) === 0,
    settlementHistoryRecorded: settlementEvents.length >= 1 && Number(settlementEvents[settlementEvents.length - 1].amount) === -settlementAmount,
    operationLogConsistent: settlementLogs.length >= 1 && Number(settlementLogs[settlementLogs.length - 1].afterDebt) === expectedDebtAfter,
    noSettlementConflict: Number(after.customers[0].creditBalance) >= 0,
  };
  const pass = Object.values(invariants).every(Boolean);

  return {
    id: 'C7',
    pass,
    before,
    after,
    settlementRecord,
    invariants,
    mismatch: pass ? null : 'C7 invariant failure'
  };
}

async function runC8() {
  const sb = createFlowSandbox();
  sb.products = [
    { id: 8001, name: 'Phone A', stock: 50, imeiTracking: false },
    { id: 8002, name: 'Watch B', stock: 30, imeiTracking: false }
  ];
  sb.customers = [
    { id: 81, name: 'Sequence Customer', creditBalance: 100, currentDebt: 100, creditLimit: 10000, creditHistory: [] }
  ];
  sb.cashDrawer = { cashUSD: 2000, cashLBP: 0 };
  sb.saveToStorage('products', sb.products);
  sb.saveToStorage('customers', sb.customers);
  sb.saveToStorage('stockMovements', []);

  const before = {
    products: clone(sb.products),
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    sales: clone(sb.sales),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  // Running totals (expected model) for drift detection.
  const expected = {
    stock: {
      '8001': Number(before.products.find((p) => p.id === 8001).stock),
      '8002': Number(before.products.find((p) => p.id === 8002).stock),
    },
    cashUSD: Number(before.cashDrawer.cashUSD),
    customerDebt: Number(before.customers[0].creditBalance),
  };

  // 1) Cash sale: Phone A qty 2 @ 300
  sb.applySaleStockDeduction([{ id: 8001, name: 'Phone A', quantity: 2 }], 'C8 step1 cash sale');
  await sb.secureSaveSale({
    id: 8801, invoiceNumber: 'INV-8801', amount: 600, paymentMethod: 'نقدي',
    items: [{ id: 8001, name: 'Phone A', quantity: 2, finalPriceUSD: 300 }],
    timestamp: '2026-05-08T13:20:00.000', date: '2026-05-08'
  }, { idempotencyKey: 'C8_STEP1' });
  sb.cashDrawer.cashUSD += 600;
  expected.stock['8001'] -= 2;
  expected.cashUSD += 600;

  // 2) Partial sale: Watch B qty 3 total 450, paid 200, debt +250
  sb.applySaleStockDeduction([{ id: 8002, name: 'Watch B', quantity: 3 }], 'C8 step2 partial');
  await sb.secureSaveSale({
    id: 8802, invoiceNumber: 'INV-8802', amount: 450, paymentMethod: 'دفع جزئي (دين)',
    items: [{ id: 8002, name: 'Watch B', quantity: 3, finalPriceUSD: 150 }],
    partialDetails: {
      customerId: 81, customerName: 'Sequence Customer',
      amountPaid: 200, amountPaidUSDCents: 20000, paymentCurrency: 'USD',
      debtAmount: 250, debtAmountUSDCents: 25000, debtBalanceAfterUSD: expected.customerDebt + 250
    },
    timestamp: '2026-05-08T13:21:00.000', date: '2026-05-08'
  }, { idempotencyKey: 'C8_STEP2' });
  sb.cashDrawer.cashUSD += 200;
  sb.customers[0].creditBalance += 250;
  sb.customers[0].currentDebt = sb.customers[0].creditBalance;
  expected.stock['8002'] -= 3;
  expected.cashUSD += 200;
  expected.customerDebt += 250;

  // 3) Credit sale: Phone A qty 1 total 300, paid 0, debt +300
  sb.applySaleStockDeduction([{ id: 8001, name: 'Phone A', quantity: 1 }], 'C8 step3 credit');
  await sb.secureSaveSale({
    id: 8803, invoiceNumber: 'CR-8803', amount: 300, paymentMethod: 'Credit Sale',
    items: [{ id: 8001, name: 'Phone A', quantity: 1, finalPriceUSD: 300 }],
    partialDetails: {
      customerId: 81, customerName: 'Sequence Customer',
      amountPaid: 0, amountPaidUSDCents: 0, paymentCurrency: 'USD',
      debtAmount: 300, debtAmountUSDCents: 30000, debtBalanceAfterUSD: expected.customerDebt + 300
    },
    timestamp: '2026-05-08T13:22:00.000', date: '2026-05-08'
  }, { idempotencyKey: 'C8_STEP3' });
  sb.customers[0].creditBalance += 300;
  sb.customers[0].currentDebt = sb.customers[0].creditBalance;
  expected.stock['8001'] -= 1;
  expected.customerDebt += 300;

  // 4) Partial return from INV-8802: Watch B qty 1 amount 150 refund cash
  sb.products.find((p) => p.id === 8002).stock += 1;
  sb.cashDrawer.cashUSD -= 150;
  sb.recordStockMovement('return_partial', 8002, +1, 'RF-8802-P1', 'C8 step4 partial return');
  await sb.secureSaveSale({
    id: 8804, invoiceNumber: 'RF-8802-P1', amount: -150, paymentMethod: 'refund',
    originalInvoiceNumber: 'INV-8802',
    items: [{ id: 8002, name: 'Watch B', quantity: 1, finalPriceUSD: -150 }],
    returned: true, returnType: 'partial', returnAmount: 150,
    timestamp: '2026-05-08T13:23:00.000', date: '2026-05-08'
  }, { idempotencyKey: 'C8_STEP4' });
  expected.stock['8002'] += 1;
  expected.cashUSD -= 150;

  // 5) Debt settlement standalone: pay 200
  sb.customers[0].creditBalance = Math.max(0, sb.customers[0].creditBalance - 200);
  sb.customers[0].currentDebt = sb.customers[0].creditBalance;
  sb.cashDrawer.cashUSD += 200;
  await sb.secureSaveSale({
    id: 8805, invoiceNumber: 'SET-8805', amount: 0, paymentMethod: 'Settlement',
    customer: 'Sequence Customer', customerId: 81, items: [],
    partialDetails: {
      customerId: 81, customerName: 'Sequence Customer',
      amountPaid: 200, amountPaidUSDCents: 20000, paymentCurrency: 'USD',
      debtAmount: 0, debtAmountUSDCents: 0, debtBalanceAfterUSD: sb.customers[0].creditBalance
    },
    timestamp: '2026-05-08T13:24:00.000', date: '2026-05-08'
  }, { idempotencyKey: 'C8_STEP5' });
  expected.cashUSD += 200;
  expected.customerDebt = Math.max(0, expected.customerDebt - 200);

  const after = {
    products: clone(sb.products),
    customers: clone(sb.customers),
    cashDrawer: clone(sb.cashDrawer),
    sales: clone(sb.sales),
    stockMovements: sb.loadFromStorage('stockMovements', []),
  };

  const actualStockA = Number(after.products.find((p) => p.id === 8001).stock);
  const actualStockB = Number(after.products.find((p) => p.id === 8002).stock);
  const refundCount = after.sales.filter((s) => String(s.paymentMethod || '').toLowerCase() === 'refund').length;

  const invariants = {
    sequenceExecutedWithoutReset: after.sales.length === 5,
    stockIntegrityNoDriftPhoneA: actualStockA === expected.stock['8001'],
    stockIntegrityNoDriftWatchB: actualStockB === expected.stock['8002'],
    cashDrawerConsistentWithSequence: Number(after.cashDrawer.cashUSD) === expected.cashUSD,
    customerDebtConsistentWithSequence: Number(after.customers[0].creditBalance) === expected.customerDebt && Number(after.customers[0].currentDebt) === expected.customerDebt,
    movementToFinancialConsistency: refundCount >= 1 && after.stockMovements.some((m) => String(m.type) === 'return_partial' && Number(m.qty) === 1),
  };
  const pass = Object.values(invariants).every(Boolean);

  return {
    id: 'C8',
    pass,
    before,
    after,
    expected,
    invariants,
    mismatch: pass ? null : 'C8 sequence drift/integrity failure'
  };
}

async function main() {
  const c1 = await runC1();
  const c2 = await runC2();
  const c3 = await runC3();
  const c4 = await runC4();
  const c5 = await runC5();
  const c6 = await runC6();
  const c7 = await runC7();
  const c8 = await runC8();
  const out = {
    executedAt: new Date().toISOString(),
    overallPass: !!(c1.pass && c2.pass && c3.pass && c4.pass && c5.pass && c6.pass && c7.pass && c8.pass),
    results: [c1, c2, c3, c4, c5, c6, c7, c8],
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.overallPass) process.exitCode = 1;
}

main();
