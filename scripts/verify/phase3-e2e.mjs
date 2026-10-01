/* global document, indexedDB, caches, location */
/**
 * TEST-ONLY Phase 3 verification harness. Runs ONLY against the local emulators (project demo-zelvero)
 * and the local preview server; it refuses any other project. Drives a separate HEADLESS Chrome with a
 * dedicated, freshly deleted profile through the DevTools protocol, so no human input can reach it.
 * All page actions are synthetic (untrusted) DOM events; a monitor records every *trusted* input event
 * and the run stops if one ever appears.
 *
 * Evidence is read from the Firestore emulator (server state) and from IndexedDB, never from the UI alone.
 *
 * Usage (emulators running, nothing on :4173):  node scripts/verify/phase3-e2e.mjs [G|H|I|X ...]
 *   G = offline cold start, H = update safety, I = shared-device isolation, X = cross-tenant
 */
import { execSync, spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'demo-zelvero';
if (!PROJECT.startsWith('demo-')) throw new Error('emulator-only harness');
const ROOT = process.cwd();
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = join(tmpdir(), 'zelvero-chrome');
const DEBUG_PORT = 9333;
const APP = 'http://localhost:4173';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const PASSWORD = 'demo-pass-1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), steps: [], results: {} };
let current = '';
function log(step, data = {}) {
  const entry = { at: new Date().toISOString(), scenario: current, step, ...data };
  report.steps.push(entry);
  console.log(JSON.stringify(entry));
}
class CheckFailed extends Error {}
function check(cond, what, data) {
  log(`${cond ? 'PASS' : 'FAIL'} ${what}`, data === undefined ? {} : { data });
  if (!cond) throw new CheckFailed(what);
}
async function poll(fn, ms, label) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(300);
  }
  throw new Error(`timeout: ${label} (${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

/* ---------------------------------------------------------------- emulator / server state */

const val = (f) => {
  if (!f) return undefined;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('stringValue' in f) return f.stringValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields ?? {}).map(([k, v]) => [k, val(v)]));
  if ('timestampValue' in f) return f.timestampValue;
  return '?';
};
async function adminDocs(path) {
  const res = await fetch(`${FS}/${path}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return ((await res.json()).documents ?? []).map((d) => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, val(v)])) }));
}
async function adminDoc(path) {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) return null;
  const d = await res.json();
  return Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, val(v)]));
}
async function serverState(T = 'demoStore') {
  const [products, sales, movements, cashTx, drawer, counter] = await Promise.all([
    adminDocs(`tenants/${T}/products`),
    adminDocs(`tenants/${T}/sales`),
    adminDocs(`tenants/${T}/stockMovements`),
    adminDocs(`tenants/${T}/cashTransactions`),
    adminDoc(`tenants/${T}/cashbox/summary`),
    adminDoc(`tenants/${T}/counters/sales`),
  ]);
  return {
    drawerUsdCents: drawer?.usdCents,
    nextInvoice: counter?.nextId,
    stock: Object.fromEntries(products.map((p) => [p.id, p.stock])),
    status: Object.fromEntries(products.map((p) => [p.id, p.status])),
    sales: sales.map((s) => ({ id: s.id, invoice: s.invoiceNumber, offlineRef: s.offlineRef, offline: s.offline, totalUsdCents: s.totalUsdCents, createdBy: s.createdBy })),
    movements: movements.map((m) => ({ productId: m.productId, type: m.type, quantity: m.quantity, stockAfter: m.stockAfter, refId: m.refId, refNumber: m.refNumber })),
    cashTx: cashTx.map((c) => ({ type: c.type, usdCents: c.usdCents, refId: c.refId, refNumber: c.refNumber, balanceAfterUsd: c.balanceAfter?.usdCents })),
  };
}
const brief = (s) => ({ drawer: s.drawerUsdCents, next: s.nextInvoice, stock: s.stock, sales: s.sales.length, movements: s.movements.length, cashTx: s.cashTx.length });

async function resetEmulators() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  execSync('node scripts/seed-emulator.mjs', { cwd: ROOT, stdio: 'pipe' });
  log('emulators wiped and reseeded');
}

/* ---------------------------------------------------------------- build / preview */

function build(tag) {
  const env = { ...process.env };
  delete env.ZELVERO_BUILD_TAG;
  if (tag) env.ZELVERO_BUILD_TAG = tag;
  const out = execSync('npx vite build --mode emulator', { cwd: ROOT, env, encoding: 'utf8', stdio: 'pipe' });
  const version = /\[sw\] dist\/sw\.js: (\d+) app-shell files, version ([0-9a-f]{16})/.exec(out);
  if (!version) throw new Error(`no [sw] line in build output:\n${out.slice(-800)}`);
  execSync('node scripts/verify-app-shell.mjs', { cwd: ROOT, stdio: 'pipe' });
  log('built', { tag: tag ?? null, files: Number(version[1]), version: version[2] });
  return version[2];
}
let preview = null;
const appUp = () => fetch(`${APP}/sw.js`).then((r) => r.ok, () => false);
async function startPreview() {
  if (await appUp()) throw new Error('something already serves :4173');
  preview = spawn('npx vite preview --mode emulator --port 4173 --strictPort', { cwd: ROOT, shell: true, stdio: 'ignore' });
  await poll(appUp, 30_000, 'preview up');
  log('preview server started');
}
async function stopPreview() {
  if (preview) execSync(`taskkill /PID ${preview.pid} /T /F`, { stdio: 'ignore' });
  preview = null;
  await poll(async () => !(await appUp()), 15_000, 'preview down');
  const listening = execSync('netstat -ano', { encoding: 'utf8' }).split('\n').some((l) => /:4173\s.*LISTENING/.test(l));
  check(!listening, 'app server stopped: nothing listens on :4173');
}

/* ---------------------------------------------------------------- Chrome over CDP */

let browser = null;
let page = null;

function profileProcesses() {
  const out = execSync(
    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object CommandLine -like '*zelvero-chrome*' | Measure-Object).Count"`,
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}
function profileCommandLine() {
  return execSync(
    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object CommandLine -like '*zelvero-chrome*' | Where-Object CommandLine -notlike '*--type=*' | Select-Object -First 1).CommandLine"`,
    { encoding: 'utf8' },
  ).trim();
}

function cdp(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message}`));
      else ok(msg.result);
    }
  };
  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error('CDP websocket error'));
    ws.onopen = () =>
      resolve({
        send(method, params = {}, sessionId) {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          return new Promise((ok, fail) => pending.set(id, { ok, fail }));
        },
        close: () => ws.close(),
      });
  });
}

async function launch({ offline }) {
  check(profileProcesses() === 0, 'no previous test-browser process is running before launch');
  const args = [
    '--headless=new',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
    ...(offline ? ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'] : []),
    'about:blank',
  ];
  spawn(CHROME, args, { stdio: 'ignore' });
  const version = await poll(() => fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()), 20_000, 'chrome debug endpoint');
  browser = await cdp(version.webSocketDebuggerUrl);
  const cmd = profileCommandLine();
  if (offline) check(cmd.includes('--proxy-server=http://127.0.0.1:9') && cmd.includes('<-loopback>'), 'browser runs with zero connectivity (dead proxy, loopback not bypassed)');
  else check(!cmd.includes('--proxy-server'), 'browser runs with normal connectivity');
  log('browser launched', { offline, headless: true, profile: PROFILE });
}

async function closeBrowser() {
  try {
    await browser?.send('Browser.close');
  } catch {
    /* already gone */
  }
  browser?.close();
  browser = null;
  page = null;
  await poll(() => profileProcesses() === 0, 20_000, 'browser fully closed');
  log('browser fully closed (no process left for the test profile)');
}

const MONITOR = `(() => {
  const K = '__e2e_trusted';
  let scripted = null;
  const rec = (e) => {
    if (!e.isTrusted) {
      if (e.type === 'click') scripted = e.target;
      return;
    }
    if ((e.type === 'input' || e.type === 'change') && e.target === scripted) return;
    try {
      const a = JSON.parse(localStorage.getItem(K) || '[]');
      a.push({ t: e.type, at: Date.now(), path: location.pathname, target: ((e.target && e.target.tagName) || '') + ' ' + ((e.target && e.target.textContent) || '').trim().slice(0, 40) });
      localStorage.setItem(K, JSON.stringify(a));
    } catch {}
  };
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'input', 'change', 'wheel', 'touchstart']) addEventListener(t, rec, true);
  addEventListener('click', () => setTimeout(() => (scripted = null)), true);
})();`;

async function openPage(path, { offline = false, block = [] } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  if (offline) await s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  if (block.length) await s('Network.setBlockedURLs', { urls: block });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: MONITOR });
  page = { s };
  await s('Page.navigate', { url: `${APP}${path}` });
  await poll(() => ev('document.readyState === "complete" && location.origin === "http://localhost:4173"'), 30_000, `load ${path}`);
  log('page opened', { path, offline, blocked: block });
}
async function setBlocked(urls) {
  await page.s('Network.setBlockedURLs', { urls });
  log('request blocking', { urls });
}

async function ev(expression) {
  const r = await page.s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** Helpers available inside page functions as `h`. */
function pageHelpers() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const buttons = () => [...document.querySelectorAll('button')];
  const findBtn = (pred, root = document) => [...root.querySelectorAll('button')].find((b) => pred(norm(b.innerText), b));
  const click = (pred, what, root) => {
    const b = findBtn(pred, root);
    if (!b) throw new Error(`button not found: ${what}`);
    if (b.disabled) throw new Error(`button disabled: ${what}`);
    b.click();
    return true;
  };
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const dialogs = () => [...document.querySelectorAll('[role=dialog]')];
  const products = () => buttons().map((b) => norm(b.innerText)).filter((t) => / in stock$/.test(t));
  return { norm, buttons, findBtn, click, setVal, dialogs, products, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
}
async function run(fn, ...args) {
  return ev(`(async () => { const h = (${pageHelpers.toString()})(); return await (${fn.toString()})(h, ...${JSON.stringify(args)}); })()`);
}
async function waitPage(fn, ms, label, ...args) {
  return poll(() => run(fn, ...args), ms, label);
}

async function trusted() {
  return run(() => JSON.parse(localStorage.getItem('__e2e_trusted') || '[]'));
}
async function assertNoForeignInput(where) {
  const events = await trusted();
  if (events.length) {
    log('FOREIGN INPUT DETECTED', { where, events, server: brief(await serverState()), idb: await idb() });
    throw new CheckFailed(`foreign trusted input detected at ${where}`);
  }
}

/* ---------------------------------------------------------------- page-side evidence */

async function idb() {
  return run(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'zelvero-offline')) return [];
    const db = await new Promise((ok, err) => {
      const r = indexedDB.open('zelvero-offline');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
    const ops = await new Promise((ok) => {
      const r = db.transaction('operations').objectStore('operations').getAll();
      r.onsuccess = () => ok(r.result);
    });
    db.close();
    return ops.map((o) => ({ id: o.id, uid: o.uid, tenantId: o.tenantId, status: o.status, offlineRef: o.offlineRef, attempts: o.attempts, invoice: o.result?.invoiceNumber ?? null, totalUsdCents: o.snapshot.totalUsdCents, cashUsdCents: o.snapshot.received.usdCents }));
  });
}
async function sw() {
  return run(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const ask = (w) =>
      w
        ? new Promise((ok) => {
            const ch = new MessageChannel();
            ch.port1.onmessage = (e) => ok(e.data.version);
            w.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
            setTimeout(() => ok('no reply'), 2000);
          })
        : null;
    const meta = (await caches.has('zelvero-sw-meta')) ? await (await (await caches.open('zelvero-sw-meta')).match('/__sw-state'))?.json() : null;
    return { online: navigator.onLine, controlledBy: await ask(navigator.serviceWorker.controller), active: await ask(reg?.active), waiting: await ask(reg?.waiting), caches: (await caches.keys()).sort(), meta };
  });
}
async function carts() {
  return run(() =>
    Object.fromEntries(
      Object.entries(localStorage)
        .filter(([k]) => k.startsWith('zelvero.cart.'))
        .map(([k, v]) => [k, JSON.parse(v).carts.map((c) => c.lines.map((l) => `${l.name} x${l.quantity}`).join(', '))]),
    ),
  );
}
async function cacheContents() {
  return run(async () => {
    const out = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
    return out;
  });
}

/* ---------------------------------------------------------------- UI actions */

async function login(email) {
  await waitPage(() => !!document.querySelector('input[name=email]'), 20_000, 'login form');
  await run(
    (h, e, p) => {
      h.setVal(document.querySelector('input[name=email]'), e);
      h.setVal(document.querySelector('input[name=password]'), p);
      return h.click((t) => t === 'Sign in', 'Sign in');
    },
    email,
    PASSWORD,
  );
  await waitPage(() => location.pathname !== '/login' && !!document.querySelector('header'), 30_000, 'signed in');
  log('signed in', { email });
}
async function gotoPos() {
  await run(() => {
    const a = document.querySelector('a[href="/pos"]');
    if (!a) throw new Error('POS link missing');
    a.click();
    return true;
  });
  await waitPage((h) => location.pathname === '/pos' && h.products().length >= 4, 30_000, 'POS products');
}
async function signOut() {
  await run((h) => h.click((t) => t === 'Sign out', 'Sign out'));
  await waitPage(() => location.pathname === '/login' && !!document.querySelector('input[name=email]'), 20_000, 'signed out');
  log('signed out');
}
async function addProduct(name) {
  await run((h, n) => h.click((t) => t.startsWith(`${n} $`) && / in stock$/.test(t), `product ${n}`), name);
  await sleep(200);
}
async function completeSale() {
  await run((h) => h.click((t) => t.startsWith('Complete sale'), 'Complete sale'));
  return waitPage(
    (h) => {
      const d = h.dialogs().find((x) => /Offline sale saved|Sale completed/.test(x.innerText));
      return d ? h.norm(d.innerText) : null;
    },
    30_000,
    'sale result dialog',
  );
}
async function printProofText() {
  return run(async (h) => {
    h.click((t) => t === 'Print offline proof' || t === 'Print', 'print button');
    const frame = document.querySelector('iframe[aria-hidden=true]');
    return frame ? h.norm(frame.contentDocument.body.innerText) : null;
  });
}
async function closeDialog() {
  await run(() => {
    const d = [...document.querySelectorAll('[role=dialog]')].pop();
    d.querySelector('button.modal__close').click();
    return true;
  });
  await sleep(300);
}
async function headerChips() {
  return run((h) => ({
    net: h.norm(document.querySelector('[data-testid=net-status]')?.innerText),
    pending: h.norm(document.querySelector('[data-testid=queue-pending]')?.innerText) || null,
    syncing: h.norm(document.querySelector('[data-testid=queue-syncing]')?.innerText) || null,
    action: h.norm(document.querySelector('[data-testid=queue-action]')?.innerText) || null,
    history: !!document.querySelector('button[aria-label="Offline sales queue"]'),
  }));
}
async function openQueuePanel({ showHandled = false } = {}) {
  await run(() => {
    const b = document.querySelector('[data-testid=queue-pending],[data-testid=queue-action],[data-testid=queue-syncing],button[aria-label="Offline sales queue"]');
    if (!b) throw new Error('no queue chip');
    b.click();
    return true;
  });
  await waitPage((h) => h.dialogs().some((d) => d.innerText.includes('Offline sales queue')), 10_000, 'queue panel');
  if (showHandled) {
    await run(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.innerText.includes('Show handled and synced'));
      const input = label.querySelector('input') ?? document.getElementById(label.htmlFor);
      if (!input.checked) input.click();
      return true;
    });
    await sleep(300);
  }
  const text = await run((h) => h.norm(h.dialogs().find((d) => d.innerText.includes('Offline sales queue')).innerText));
  await closeDialog();
  return text;
}
async function storeName() {
  return run(() => document.querySelector('header')?.innerText.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? null);
}

/* ================================================================ SCENARIO G */

async function scenarioG() {
  current = 'G';
  const r = (report.results.G = { status: 'RUNNING' });
  await closeBrowserIfAny();
  rmSync(PROFILE, { recursive: true, force: true });
  log('dedicated profile deleted (clean service worker, caches, IndexedDB, localStorage)');
  await resetEmulators();
  r.V1 = build(null);
  await startPreview();

  // G1–G2 online load, worker installed and controlling
  await launch({ offline: false });
  await openPage('/login');
  await login('cashier@zelvero.test');
  await gotoPos();
  let s = await sw();
  if (!s.controlledBy) {
    await ev('location.reload()');
    await waitPage((h) => h.products().length >= 4, 30_000, 'POS after reload');
    s = await sw();
  }
  check(s.controlledBy === r.V1 && s.active === r.V1 && s.waiting === null, 'G2 service worker V1 installed, active and controlling', s);
  const cached = await cacheContents();
  const shellUrls = cached[`zelvero-shell-${r.V1}`] ?? [];
  const foreign = Object.values(cached).flat().filter((u) => !u.startsWith(`${APP}/`));
  check(shellUrls.length === 51 && foreign.length === 0, 'G2 shell cache holds exactly the 51 build files and nothing cross-origin', { count: shellUrls.length, foreign, caches: Object.keys(cached) });
  // G3 queue empty
  check((await idb()).length === 0, 'G3 offline queue empty');
  // G4 baseline
  const baseline = await serverState();
  r.baseline = brief(baseline);
  check(baseline.drawerUsdCents === 10_000 && baseline.stock.case === 20 && baseline.nextInvoice === 1 && baseline.sales.length === 0, 'G4 baseline server state', r.baseline);
  await assertNoForeignInput('G online');

  // G5–G6 disconnect and close
  await stopPreview();
  await closeBrowser();

  // G7–G8 reopen offline
  await launch({ offline: true });
  await openPage('/pos', { offline: true });
  await waitPage((h) => h.products().length >= 4, 30_000, 'offline POS products');
  const offlineView = await run((h) => ({
    online: navigator.onLine,
    viaServiceWorker: performance.getEntriesByType('navigation')[0]?.workerStart > 0,
    navStatus: performance.getEntriesByType('navigation')[0]?.responseStatus,
    products: h.products(),
    banner: document.body.innerText.includes('You are offline. Completed sales are saved on this device as PENDING'),
  }));
  offlineView.store = await storeName();
  offlineView.chips = await headerChips();
  offlineView.probes = await run(async () => {
    const probe = (u) => fetch(u, { cache: 'no-store' }).then((x) => `reachable ${x.status}`, () => 'unreachable');
    return { firestore: await probe('http://127.0.0.1:8080/'), auth: await probe('http://127.0.0.1:9099/'), functions: await probe('http://127.0.0.1:5001/'), appServer: await probe('/robots.txt') };
  });
  check(
    offlineView.viaServiceWorker && offlineView.navStatus === 200 && offlineView.store === 'Demo Store' && offlineView.products.length === 4 && offlineView.chips.net === 'Offline' && offlineView.online === false && offlineView.banner,
    'G8 app shell, store name, cached products and OFFLINE status with zero connectivity',
    offlineView,
  );
  check(Object.values(offlineView.probes).every((p) => p === 'unreachable'), 'G8 Firestore, Auth, Functions and the app server are all unreachable', offlineView.probes);

  // G9–G10 offline sale
  await addProduct('Phone case');
  const dialog = await completeSale();
  const ref = /OFF-[A-Z0-9]{6}/.exec(dialog)?.[0];
  r.offlineRef = ref;
  check(
    !!ref && dialog.includes('Offline sale saved — pending sync') && dialog.includes('Pending sync') && !/INV-\d+/.test(dialog) && dialog.includes('Cash received ($5.00) is physically with you but is NOT recorded in the official cash drawer'),
    'G10 OFF reference, PENDING, no INV number, physical-cash warning',
    { dialog },
  );
  const receipt = await printProofText();
  check(!!receipt && receipt.includes('OFFLINE SALE — PENDING SYNCHRONIZATION') && receipt.includes('NOT AN OFFICIAL INVOICE') && receipt.includes(ref) && !/INV-\d+/.test(receipt), 'G10 offline receipt (proof) printed without an invoice number', { receipt });
  await sleep(800);
  await closeDialog();
  const ops1 = await idb();
  check(ops1.length === 1 && ops1[0].status === 'PENDING_SYNC' && ops1[0].offlineRef === ref && ops1[0].invoice === null && ops1[0].uid === 'cashier1' && ops1[0].tenantId === 'demoStore' && ops1[0].totalUsdCents === 500 && ops1[0].cashUsdCents === 500, 'G10 IndexedDB: 1 PENDING_SYNC record, no invoice', ops1);
  r.operationId = ops1[0].id;
  check((await headerChips()).pending === '1 pending', 'G10 header shows "1 pending"');
  check(JSON.stringify(brief(await serverState())) === JSON.stringify(r.baseline), 'G10 server state unchanged while offline', brief(await serverState()));
  await assertNoForeignInput('G offline sale');

  // G12–G15 close and reopen, still offline
  await closeBrowser();
  await launch({ offline: true });
  await openPage('/pos', { offline: true });
  await waitPage((h) => h.products().length >= 4, 30_000, 'offline POS after reopen');
  const chips2 = await headerChips();
  const panel2 = await openQueuePanel();
  check(chips2.net === 'Offline' && chips2.pending === '1 pending' && panel2.includes(ref) && panel2.includes('Pending sync'), 'G14 pending sale still visible after reopening offline', { chips2, panel2 });
  const ops2 = await idb();
  check(ops2.length === 1 && ops2[0].id === r.operationId && ops2[0].status === 'PENDING_SYNC' && ops2[0].attempts === 0 && ops2[0].invoice === null, 'G15 IndexedDB record survived the browser restart', ops2);
  check(JSON.stringify(brief(await serverState())) === JSON.stringify(r.baseline), 'G15 server state still unchanged', brief(await serverState()));
  await assertNoForeignInput('G reopen offline');

  // G16–G18 reconnect and sync
  await closeBrowser();
  await startPreview();
  await launch({ offline: false });
  await openPage('/pos');
  await poll(async () => (await idb())[0]?.status === 'SYNCED', 90_000, 'operation SYNCED');
  const ops3 = await idb();
  const after = await serverState();
  r.final = brief(after);
  r.invoice = ops3[0].invoice;
  const sale = after.sales[0];
  check(ops3.length === 1 && ops3[0].status === 'SYNCED' && ops3[0].invoice === 'INV-001', 'G18 IndexedDB: SYNCED with official invoice INV-001', ops3);
  check(after.sales.length === 1 && sale.id === r.operationId && sale.offlineRef === ref && sale.invoice === 'INV-001' && sale.offline === true && sale.createdBy === 'cashier1' && sale.totalUsdCents === 500, 'G18 exactly one server sale, linked OFF → INV, id = queue id', after.sales);
  check(after.drawerUsdCents === 10_500 && after.stock.case === 19 && after.stock.cable === 20 && after.stock.last === 1 && after.stock.phone === 2 && after.nextInvoice === 2, 'G18 drawer +500 once, case stock −1 once, counter +1 once', brief(after));
  check(after.movements.length === 1 && after.movements[0].refId === r.operationId && after.movements[0].quantity === -1 && after.movements[0].productId === 'case', 'G18 exactly one stock movement for the sale', after.movements);
  check(after.cashTx.length === 1 && after.cashTx[0].refId === r.operationId && after.cashTx[0].usdCents === 500 && after.cashTx[0].balanceAfterUsd === 10_500, 'G18 exactly one cash transaction for the sale', after.cashTx);
  const panel3 = await openQueuePanel({ showHandled: true });
  check(panel3.includes(ref) && panel3.includes('Synced') && panel3.includes('INV-001'), 'G18 queue panel shows Synced with the official invoice', { panel3 });

  // G19 refresh twice, no duplicate
  for (let i = 1; i <= 2; i += 1) {
    await ev('location.reload()');
    await waitPage((h) => h.products().length >= 4, 30_000, 'POS after refresh');
    await sleep(25_000);
    const st = await serverState();
    const op = (await idb())[0];
    check(JSON.stringify(brief(st)) === JSON.stringify(r.final) && op.status === 'SYNCED' && op.attempts === ops3[0].attempts, `G19 refresh ${i}: no duplicate sync`, { server: brief(st), op });
  }
  r.duplicateCheck = 'no duplicate after 2 refreshes (25 s each)';
  r.attempts = ops3[0].attempts;
  await assertNoForeignInput('G end');
  r.status = 'PASS';
}

async function closeBrowserIfAny() {
  if (browser || profileProcesses() > 0) {
    try {
      await closeBrowser();
    } catch {
      execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object CommandLine -like '*zelvero-chrome*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`);
      browser = null;
    }
  }
}

/* ================================================================ SCENARIO H */

async function scenarioH() {
  current = 'H';
  const r = (report.results.H = { status: 'RUNNING' });
  r.V1 = report.results.G?.V1;
  if (!r.V1 || !browser) throw new Error('Scenario H continues from Scenario G (same profile and V1 build)');
  check(!!(await run((h) => location.pathname === '/pos' && h.products().length >= 4)), 'H start on /pos online');
  let s = await sw();
  check(s.controlledBy === r.V1 && s.active === r.V1 && s.waiting === null && s.caches.filter((c) => c.startsWith('zelvero-shell-')).length === 1, 'H1 V1 active and controlling, nothing waiting', s);
  const marker = await ev('window.__marker = Date.now()');

  // H2 active cart
  await addProduct('Phone case');
  await addProduct('Phone case');
  await addProduct('USB cable');
  const cart1 = await carts();
  check(JSON.stringify(cart1['zelvero.cart.demoStore.cashier1']) === JSON.stringify(['Phone case x2, USB cable x1']), 'H2 active cart holds Phone case ×2 and USB cable ×1', cart1);

  // H3 build V2 and let the page check for it
  r.V2 = build('scenario-h-1');
  check(r.V2 !== r.V1, 'H3 V2 differs from V1');
  await run(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
    return true;
  });
  await waitPage(() => !!document.querySelector('[data-testid=update-notice]'), 30_000, 'update notice');
  s = await sw();
  const notice = await run((h) => h.norm(document.querySelector('[data-testid=update-notice]').innerText));
  const markerNow = await ev('window.__marker');
  const cart2 = await carts();
  const cartUi = await run(() => document.body.innerText.includes('Phone case') && document.body.innerText.includes('USB cable'));
  check(s.controlledBy === r.V1 && s.active === r.V1 && s.waiting === r.V2 && s.meta?.current === `zelvero-shell-${r.V1}`, 'H4 V2 installed and WAITING, V1 still active and controlling', s);
  check(s.caches.includes(`zelvero-shell-${r.V1}`) && s.caches.includes(`zelvero-shell-${r.V2}`), 'H4 both shell caches present', s.caches);
  check(markerNow === marker, 'H4 page did NOT reload', { marker, markerNow });
  check(JSON.stringify(cart2) === JSON.stringify(cart1) && cartUi, 'H4 active cart intact', cart2);
  check(notice.startsWith('New version available — refresh when ready'), 'H4 update notice shown', { notice });

  // Refresh with an active cart asks for confirmation; Cancel keeps everything
  await run((h) => h.click((t) => t === 'Refresh', 'Refresh', document.querySelector('[data-testid=update-notice]')));
  const confirmText = await waitPage((h) => h.dialogs().map((d) => h.norm(d.innerText)).find((t) => t.includes('Finish your current work first?')), 10_000, 'confirm dialog');
  check(!!confirmText, 'H4 Refresh with an active cart asks for confirmation', { confirmText });
  await run((h) => h.click((t) => t === 'Cancel', 'Cancel', h.dialogs().find((d) => d.innerText.includes('Finish your current work first?'))));
  await sleep(1500);
  s = await sw();
  check((await ev('window.__marker')) === marker && JSON.stringify(await carts()) === JSON.stringify(cart1) && s.waiting === r.V2 && s.controlledBy === r.V1, 'H4 Cancel: no reload, cart intact, V2 still waiting', s);

  // H5 finish the sale online
  const before = await serverState();
  const done = await completeSale();
  check(done.includes('Sale completed') && done.includes('INV-002'), 'H5 sale completed online as INV-002', { done });
  await closeDialog();
  const afterSale = await serverState();
  check(
    afterSale.sales.length === before.sales.length + 1 && afterSale.drawerUsdCents === before.drawerUsdCents + 1300 && afterSale.stock.case === before.stock.case - 2 && afterSale.stock.cable === before.stock.cable - 1 && afterSale.nextInvoice === before.nextInvoice + 1 && afterSale.movements.length === before.movements.length + 2 && afterSale.cashTx.length === before.cashTx.length + 1,
    'H5 server recorded the sale exactly once',
    { before: brief(before), after: brief(afterSale) },
  );
  check((await carts())['zelvero.cart.demoStore.cashier1'].join('') === '', 'H5 cart empty after the sale');

  // H6–H7 manual refresh activates V2
  await run((h) => h.click((t) => t === 'Refresh', 'Refresh', document.querySelector('[data-testid=update-notice]')));
  await poll(async () => (await ev('window.__marker === undefined && document.readyState === "complete"')) === true, 20_000, 'reload after Refresh');
  await waitPage((h) => h.products().length >= 4, 30_000, 'POS after update');
  s = await sw();
  check(s.controlledBy === r.V2 && s.active === r.V2 && s.waiting === null, 'H7 V2 active and controlling after the manual Refresh', s);
  check(s.caches.includes(`zelvero-shell-${r.V1}`) && s.caches.includes(`zelvero-shell-${r.V2}`) && s.meta?.current === `zelvero-shell-${r.V2}` && s.meta?.previous === `zelvero-shell-${r.V1}`, 'H7 previous cache (V1) kept for old tabs', s);
  check(!(await run(() => !!document.querySelector('[data-testid=update-notice]'))), 'H7 notice gone');
  check(JSON.stringify(brief(await serverState())) === JSON.stringify(brief(afterSale)) && (await idb()).every((o) => o.status === 'SYNCED'), 'H7 no sale or queue data lost or duplicated');

  // H8 V3: stale cache cleanup
  r.V3 = build('scenario-h-2');
  await run(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
    return true;
  });
  await waitPage(() => !!document.querySelector('[data-testid=update-notice]'), 30_000, 'update notice V3');
  await ev('window.__marker2 = 1');
  await run((h) => h.click((t) => t === 'Refresh', 'Refresh', document.querySelector('[data-testid=update-notice]')));
  await sleep(300);
  const sawConfirm = await run((h) => h.dialogs().some((d) => d.innerText.includes('Finish your current work first?'))).catch(() => false);
  check(!sawConfirm, 'H8 no confirmation when nothing is in progress');
  await poll(async () => (await ev('window.__marker2 === undefined && document.readyState === "complete"')) === true, 20_000, 'reload after Refresh V3');
  await waitPage((h) => h.products().length >= 4, 30_000, 'POS after V3');
  s = await sw();
  const shells = s.caches.filter((c) => c.startsWith('zelvero-shell-'));
  check(s.controlledBy === r.V3 && s.waiting === null, 'H8 V3 active and controlling', s);
  check(shells.length === 2 && shells.includes(`zelvero-shell-${r.V2}`) && shells.includes(`zelvero-shell-${r.V3}`) && !shells.includes(`zelvero-shell-${r.V1}`) && s.meta?.current === `zelvero-shell-${r.V3}` && s.meta?.previous === `zelvero-shell-${r.V2}`, 'H8 stale V1 cache deleted; only current (V3) and previous (V2) remain', s);
  r.cachesAfterV3 = s.caches;
  await assertNoForeignInput('H end');
  r.status = 'PASS';
}

/* ================================================================ SHARED DEVICE */

async function scenarioI() {
  current = 'I';
  const r = (report.results.I = { status: 'RUNNING' });
  await closeBrowserIfAny();
  rmSync(PROFILE, { recursive: true, force: true });
  log('dedicated profile deleted');
  await resetEmulators();
  if (!(await appUp())) await startPreview();
  const FN_BLOCK = ['*127.0.0.1:5001*'];

  await launch({ offline: false });
  await openPage('/login');
  await login('cashier@zelvero.test');
  await gotoPos();
  await setBlocked(FN_BLOCK);

  // I2 pending sale + item left in the cart
  await addProduct('Phone case');
  const dialog = await completeSale();
  const ref = /OFF-[A-Z0-9]{6}/.exec(dialog)?.[0];
  r.offlineRef = ref;
  check(!!ref && dialog.includes('Offline sale saved — pending sync') && dialog.includes('The server could not be reached') && !/INV-\d+/.test(dialog), 'I2 cashier1 sale queued (Functions unreachable)', { dialog });
  await closeDialog();
  await addProduct('USB cable');
  const op = (await idb())[0];
  r.operationId = op?.id;
  check((await idb()).length === 1 && op.uid === 'cashier1' && op.status === 'PENDING_SYNC', 'I2 IndexedDB: cashier1 PENDING_SYNC record', await idb());
  check(JSON.stringify((await carts())['zelvero.cart.demoStore.cashier1']) === JSON.stringify(['USB cable x1']), 'I2 cashier1 cart holds USB cable', await carts());
  check((await serverState()).sales.length === 0, 'I2 server: 0 sales');

  // I3 sign out
  await signOut();
  const afterOut = await idb();
  check(afterOut.length === 1 && afterOut[0].id === op.id && afterOut[0].status === 'PENDING_SYNC', 'I3 cashier1 record kept after sign-out', afterOut);
  const attemptsAtSignOut = afterOut[0].attempts;

  // I4–I6 cashier2
  await login('cashier2@zelvero.test');
  await gotoPos();
  const chips = await headerChips();
  check(!chips.pending && !chips.action && !chips.syncing && !chips.history, 'I5 cashier2 sees no queue chip / no queue entries', chips);
  const c2 = await carts();
  const cartTab = await run(() => [...document.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()).find((t) => /^Cart \(\d+\)$/.test(t)));
  check(cartTab === 'Cart (0)' && (c2['zelvero.cart.demoStore.cashier2'] ?? ['']).join('') === '', 'I6 cashier2 cart is empty (cashier1 USB cable not shown)', { cartTab, carts: c2 });
  check(JSON.stringify(c2['zelvero.cart.demoStore.cashier1']) === JSON.stringify(['USB cable x1']), 'I6 cashier1 cart still stored, untouched');

  // I7 cashier2 session never sends cashier1's sale, even with Functions reachable
  await setBlocked([]);
  await sleep(65_000);
  const i7 = await idb();
  check(i7.length === 1 && i7[0].status === 'PENDING_SYNC' && i7[0].attempts === attemptsAtSignOut && i7[0].uid === 'cashier1', 'I7 cashier1 record not sent by cashier2 session (65 s, Functions reachable)', i7);
  check((await serverState()).sales.length === 0, 'I7 server: still 0 sales');

  // I8 sign out; cross-tenant browser check with store B owner on the same profile
  await setBlocked(FN_BLOCK);
  await signOut();
  await login('owner2@zelvero.test');
  await gotoPos();
  const bView = {
    store: await storeName(),
    chips: await headerChips(),
    products: await run((h) => h.products()),
    mentionsStoreA: await run(() => document.body.innerText.includes('Demo Store')),
  };
  r.storeBView = bView;
  check(bView.store === 'Second Store' && !bView.mentionsStoreA && bView.products.length === 4 && bView.products.every((p) => p.startsWith('StoreB ')), 'X-UI store B owner sees only store B data', bView);
  check(!bView.chips.pending && !bView.chips.action && !bView.chips.history, 'X-UI store B owner does not see store A queue', bView.chips);
  check((await idb()).some((o) => o.id === op.id && o.status === 'PENDING_SYNC'), 'X-UI store A record still kept on the device');
  await signOut();

  // I9–I10 cashier1 back
  await login('cashier@zelvero.test');
  await gotoPos();
  const chips1 = await headerChips();
  const panel = await openQueuePanel();
  const cart1 = await carts();
  const cartUi = await run(() => [...document.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()).find((t) => /^Cart \(\d+\)$/.test(t)));
  check(chips1.pending === '1 pending' && panel.includes(ref) && panel.includes('Pending sync'), 'I10 cashier1 sees the same pending sale again', { chips1, panel });
  check(JSON.stringify(cart1['zelvero.cart.demoStore.cashier1']) === JSON.stringify(['USB cable x1']) && cartUi === 'Cart (1)', 'I10 cashier1 cart restored', { cart1, cartUi });

  // I11 reconnect
  await setBlocked([]);
  await poll(
    async () => {
      const o = (await idb()).find((x) => x.id === op.id);
      if (o?.status === 'SYNCED') return true;
      if (o?.status === 'PENDING_SYNC' && (await headerChips()).action) {
        log('retries paused (action required) — pressing Retry in the queue panel');
        await run(() => {
          document.querySelector('[data-testid=queue-action]').click();
          return true;
        });
        await waitPage((h) => h.dialogs().some((d) => d.innerText.includes('Offline sales queue')), 10_000, 'queue panel');
        await run((h) => h.click((t) => t === 'Retry', 'Retry', h.dialogs().find((d) => d.innerText.includes('Offline sales queue'))));
        await sleep(500);
        await closeDialog();
      }
      return false;
    },
    6 * 60_000,
    'cashier1 operation SYNCED',
  );
  const final = await serverState();
  const opFinal = (await idb()).find((x) => x.id === op.id);
  r.invoice = opFinal.invoice;
  r.final = brief(final);
  check(final.sales.length === 1 && final.sales[0].id === op.id && final.sales[0].offlineRef === ref && final.sales[0].createdBy === 'cashier1' && final.sales[0].invoice === 'INV-001', 'I11 synced exactly once, by cashier1', final.sales);
  check(final.drawerUsdCents === 10_500 && final.stock.case === 19 && final.nextInvoice === 2 && final.movements.length === 1 && final.cashTx.length === 1, 'I11 drawer/stock/counter/movement/cash changed exactly once', brief(final));
  await assertNoForeignInput('I end');
  r.status = 'PASS';
}

/* ================================================================ CROSS-TENANT (API level) */

async function signIn(email) {
  const res = await fetch(`${AUTH}/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) });
  const json = await res.json();
  if (!json.idToken) throw new Error(`sign-in ${email}: ${JSON.stringify(json)}`);
  return json.idToken;
}
async function fsAs(token, method, path, body) {
  const res = await fetch(`${FS}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.status;
}
async function callAs(token, name, data) {
  const res = await fetch(`${FUNCTIONS}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  const json = await res.json();
  return json.error ? { error: json.error.status, key: json.error.details?.key ?? json.error.message } : { ok: true, result: json.result };
}

async function scenarioX() {
  current = 'X';
  const r = (report.results.X = { status: 'RUNNING', checks: [] });
  const t = {
    cashierA: await signIn('cashier@zelvero.test'),
    ownerA: await signIn('owner@zelvero.test'),
    ownerB: await signIn('owner2@zelvero.test'),
  };
  // a real sale in store B so returns can be attempted against it
  const bSaleId = `bsale${Date.now()}`;
  const bSale = await callAs(t.ownerB, 'posCheckout', {
    saleId: bSaleId,
    kind: 'cash',
    currency: 'USD',
    rate: 89_500,
    customerId: null,
    debtLineUsdCents: null,
    lines: [{ productId: 'b-cable', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }],
    expectedTotalUsdCents: 300,
    cash: { receivedUsdCents: 300, receivedLbp: 0 },
  });
  check(!!bSale.ok, 'X setup: store B owner sells in store B (positive control)', bSale);
  const snapB = async () => ({ ...(await serverState('demoStore2')), customer: await adminDoc('tenants/demoStore2/customers/b-sara'), settings: await adminDoc('tenants/demoStore2/settings/main'), bCashier: await adminDoc('users/b-cashier') });
  const before = { B: await snapB(), A: await serverState('demoStore') };

  const control = await fsAs(t.cashierA, 'GET', 'tenants/demoStore/products/case');
  check(control === 200, 'X control: store A cashier can read store A product', { status: control });
  const reads = [
    'tenants/demoStore2/products/b-case',
    'tenants/demoStore2/products',
    `tenants/demoStore2/sales/${bSaleId}`,
    'tenants/demoStore2/sales',
    'tenants/demoStore2/customers/b-sara',
    'tenants/demoStore2/customers',
    'tenants/demoStore2/cashbox/summary',
    'tenants/demoStore2/settings/main',
    'tenants/demoStore2/counters/sales',
    'tenants/demoStore2/stockMovements',
    'tenants/demoStore2/cashTransactions',
    'users/demoStore2',
    'users/b-cashier',
  ];
  for (const who of ['cashierA', 'ownerA']) {
    for (const path of reads) {
      const status = await fsAs(t[who], 'GET', path);
      r.checks.push({ who, op: 'read', path, status });
      check(status === 403, `X ${who} read ${path} denied`, { status });
    }
  }
  const writes = [
    ['PATCH', 'tenants/demoStore2/products/b-case?updateMask.fieldPaths=stock', { fields: { stock: { integerValue: '999' } } }],
    ['PATCH', 'tenants/demoStore2/cashbox/summary?updateMask.fieldPaths=usdCents', { fields: { usdCents: { integerValue: '1' } } }],
    ['PATCH', 'tenants/demoStore2/settings/main?updateMask.fieldPaths=storeName', { fields: { storeName: { stringValue: 'hacked' } } }],
    ['POST', 'tenants/demoStore2/sales', { fields: { invoiceNumber: { stringValue: 'INV-999' } } }],
    ['DELETE', 'tenants/demoStore2/customers/b-sara'],
  ];
  for (const [method, path, body] of writes) {
    const status = await fsAs(t.ownerA, method, path, body);
    r.checks.push({ who: 'ownerA', op: method, path, status });
    check(status === 403, `X ownerA ${method} ${path} denied`, { status });
  }
  const reverse = await fsAs(t.ownerB, 'GET', 'tenants/demoStore/products/case');
  r.checks.push({ who: 'ownerB', op: 'read', path: 'tenants/demoStore/products/case', status: reverse });
  check(reverse === 403, 'X store B owner cannot read store A product', { status: reverse });

  const calls = [
    ['posCheckout', { saleId: `xsale${Date.now()}`, kind: 'cash', currency: 'USD', rate: 89_500, customerId: null, debtLineUsdCents: null, lines: [{ productId: 'b-case', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }], expectedTotalUsdCents: 500, cash: { receivedUsdCents: 500, receivedLbp: 0 } }],
    ['posCheckout', { saleId: `xsale${Date.now()}c`, kind: 'credit', currency: 'USD', rate: 89_500, customerId: 'b-sara', debtLineUsdCents: null, lines: [{ productId: 'case', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }], expectedTotalUsdCents: 500, credit: { paidUsdCents: 0, paidLbp: 0 } }],
    ['posSetProductStatus', { productId: 'b-case', status: 'archived' }],
    ['posAdjustStock', { productId: 'b-case', mode: 'set', quantity: 999, unitCostUsdCents: null, payFromCashbox: false, imeisToAdd: [], imeisToRemove: [], note: '' }],
    ['posDeleteProduct', { productId: 'b-last' }],
    ['posPayDebt', { customerId: 'b-sara', usdCents: 100, lbp: 0, rate: 89_500, note: '' }],
    ['posReturn', { saleId: bSaleId, lines: [{ index: 0, quantity: 1 }], reason: 'x' }],
    ['updateSubUser', { uid: 'b-cashier', isActive: false }],
    ['deleteSubUser', { uid: 'b-cashier' }],
  ];
  for (const [name, data] of calls) {
    const res = await callAs(t.ownerA, name, data);
    r.checks.push({ who: 'ownerA', op: 'callable', name, result: res });
    check(!res.ok, `X ownerA ${name} with store B ids rejected`, res);
  }
  const after = { B: await snapB(), A: await serverState('demoStore') };
  check(JSON.stringify(after.B) === JSON.stringify(before.B), 'X store B data unchanged after every attempt', { before: brief(before.B), after: brief(after.B) });
  check(JSON.stringify(after.A) === JSON.stringify(before.A), 'X store A data unchanged (no cross-tenant side effects)', brief(after.A));
  const bAuth = await fetch(`${AUTH}/projects/${PROJECT}/accounts:lookup`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: ['b-cashier'] }) }).then((x) => x.json());
  check(bAuth.users?.length === 1 && !bAuth.users[0].disabled, 'X store B sub-user still exists and is enabled', bAuth.users?.[0]?.disabled);
  r.status = 'PASS';
}

/* ================================================================ main */

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['G', 'H', 'I', 'X'];
const scenarios = { G: scenarioG, H: scenarioH, I: scenarioI, X: scenarioX };
let exitCode = 0;
for (const key of wanted) {
  if (key === 'H' && report.results.G?.status !== 'PASS') {
    report.results.H = { status: 'NOT RUN', error: 'Scenario H continues from a passing Scenario G' };
    continue;
  }
  try {
    await scenarios[key]();
  } catch (e) {
    exitCode = 1;
    const res = (report.results[key] ??= {});
    res.status = 'FAIL';
    res.error = e instanceof Error ? e.message : String(e);
    log(`SCENARIO ${key} STOPPED`, { error: res.error });
    try {
      log('state at stop', { server: brief(await serverState()), idb: page ? await idb() : null });
    } catch {
      /* best effort */
    }
  }
}
await closeBrowserIfAny().catch(() => undefined);
if (preview) await stopPreview().catch(() => undefined);
report.finishedAt = new Date().toISOString();
const out = join(tmpdir(), `zelvero-phase3-evidence-${Date.now()}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nEVIDENCE FILE: ${out}`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.results).map(([k, v]) => [k, v.status]))));
process.exit(exitCode);
