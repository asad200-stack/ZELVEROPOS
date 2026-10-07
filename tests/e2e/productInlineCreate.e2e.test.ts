/* eslint-disable @typescript-eslint/no-explicit-any -- Chrome DevTools Protocol responses are untyped JSON. */
/**
 * Browser test of inline Category / Supplier creation inside the Add Product modal, against the LOCAL
 * emulators only (auth, firestore, functions, storage). Run through `npm run test:e2e`.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, clearAuth, createEnv, createUser, readDoc, readWhere, seedTenant, T, tp } from '../integration/helpers';

const APP = 'http://localhost:4175';
const OUT_DIR = join(tmpdir(), 'zelvero-product-e2e-dist');
const PROFILE = join(tmpdir(), 'zelvero-product-e2e-chrome');
const IMAGE = join(tmpdir(), 'zelvero-product-e2e.png');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const PASSWORD = 'integration-pass-1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll<R>(fn: () => Promise<R>, ms: number, label: string): Promise<NonNullable<R>> {
  const until = Date.now() + ms;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<R>;
      last = v;
    } catch (e) {
      last = (e as Error).message;
    }
    await sleep(150);
  }
  throw new Error(`timeout: ${label} (last: ${JSON.stringify(last)})`);
}

/* ------------------------------------------------------------------ CDP plumbing */
let ws: WebSocket;
let seq = 0;
const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
const exceptions: string[] = [];
function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, fail) => pending.set(id, { ok, fail }));
}

/** One isolated browser context (own cookies / IndexedDB) = one signed-in user. */
class Page {
  constructor(private session: string) {}
  static async open(): Promise<Page> {
    const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(sessionId);
    for (const d of ['Page.enable', 'Runtime.enable', 'DOM.enable']) await page.s(d);
    await page.s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    return page;
  }
  s(method: string, params: Record<string, unknown> = {}) {
    return send(method, params, this.session);
  }
  async ev<R = any>(expression: string): Promise<R> {
    const r = await this.s('Runtime.evaluate', { expression: `(() => { ${HELPERS}; return (${expression}); })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as R;
  }
  async go(path: string) {
    await this.s('Page.navigate', { url: APP + path });
    await poll(() => this.ev(`document.readyState === 'complete' && !!document.querySelector('#root > *') && !document.querySelector('.page-loader, .spinner--page')`), 30_000, `render ${path}`);
    await sleep(500);
  }
  text = () => this.ev<string>('document.body.innerText');
  async clickAt(selectorExpr: string, times = 1) {
    // Waits until the target is the topmost element at its centre (e.g. not covered by a toast).
    const p = await poll(() => this.ev(`(() => { const el = ${selectorExpr}; if (!el || !el.getBoundingClientRect().width) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null; })()`), 15_000, `click ${selectorExpr}`);
    for (let i = 0; i < times; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) await this.s('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    }
  }
  clickButton = (re: string, scope = 'document', times = 1) => this.clickAt(`button(${JSON.stringify(re)}, ${scope})`, times);
  async key(key: 'Escape' | 'Enter' | 'Tab') {
    const code = { Escape: 27, Enter: 13, Tab: 9 }[key];
    await this.s('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
    await this.s('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await sleep(150);
  }
  /** Sets a modal field like a user would (React sees a real input / change event). */
  fill = (label: string, value: string) => this.ev(`setValue(field(${JSON.stringify(label)}), ${JSON.stringify(value)})`);
  async type(text: string) {
    await this.s('Input.insertText', { text });
  }
  choose = (label: string, value: string) => this.ev(`(() => { const el = field(${JSON.stringify(label)}); el.focus(); setValue(el, ${JSON.stringify(value)}); return true; })()`);
  value = (label: string) => this.ev<string>(`field(${JSON.stringify(label)})?.value ?? null`);
  options = (label: string) => this.ev<string[]>(`[...field(${JSON.stringify(label)}).options].map((o) => o.value)`);
  panels = () => this.ev<number>(`document.querySelectorAll('.modal .inline-create').length`);
  focusInPanel = () => this.ev<boolean>(`!!document.activeElement?.closest('.inline-create') && document.activeElement.tagName === 'INPUT'`);
  modalOpen = () => this.ev<boolean>(`!!document.querySelector('.modal')`);
  async attachImage() {
    const { root } = await this.s('DOM.getDocument', { depth: -1 });
    const { nodeId } = await this.s('DOM.querySelector', { nodeId: root.nodeId, selector: '#product-image' });
    await this.s('DOM.setFileInputFiles', { nodeId, files: [IMAGE] });
  }
  async signIn(email: string) {
    await this.go('/login');
    await this.ev(`(() => { setValue(document.querySelector('input[name=email]'), ${JSON.stringify(email)}); setValue(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)}); return true; })()`);
    await this.clickAt(`document.querySelector('form button[type=submit]')`);
    await poll(async () => (await this.ev<string>('location.pathname')) !== '/login', 30_000, 'signed in');
  }
  async openAddProduct() {
    await this.go('/products');
    await this.clickButton('^add product$');
    await poll(() => this.ev(`!!field('Category') && !!field('Supplier')`), 15_000, 'add product modal');
  }
}

/** In-page helpers, injected into every evaluation. */
const HELPERS = `
  const field = (label) => {
    const f = [...document.querySelectorAll('.modal .field')].find((x) => x.querySelector('.field__label')?.textContent.replace('*', '').trim() === label);
    return f?.querySelector('input, select, textarea') ?? null;
  };
  const button = (re, scope) => [...(scope ?? document).querySelectorAll('button')].find((b) => new RegExp(re, 'i').test(b.innerText.trim()));
  const setValue = (el, v) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    return true;
  };
  const panel = () => document.querySelector('.modal .inline-create');
  const snapshot = () => Object.fromEntries([...document.querySelectorAll('.modal [name], #product-image')].map((el) => [el.name || el.id, el.type === 'file' ? [...el.files].map((f) => f.name).join() : el.type === 'checkbox' ? el.checked : el.value]));
`;

const PRODUCT_VALUES: [string, string][] = [
  ['Name', 'Inline Widget'],
  ['Barcode', '9990001'],
  ['Retail ($)', '12.50'],
  ['Wholesale ($)', '11'],
  ['Cost ($)', '7.25'],
  ['Minimum stock', '3'],
  ['Expiry date', '2027-05-01'],
  ['Initial stock', '4'],
];

/** Every product field except the two being edited inline. */
async function productState(page: Page) {
  const snap = await page.ev<Record<string, unknown>>('snapshot()');
  delete snap.category;
  delete snap.supplierId;
  return snap;
}

/* ------------------------------------------------------------------ setup */
let env: RulesTestEnvironment;
let preview: ChildProcess;
const DENIED = 'deniedUser';
const NOSUP = 'noSupplierUser';

beforeAll(async () => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Run through `npm run test:e2e` (emulators not detected).');
  env = await createEnv();
  await env.clearFirestore();
  await clearAuth();
  const productPerms = { canViewProducts: true, canAddProducts: true };
  await seedTenant(env, T, [
    { uid: T, role: 'owner' },
    // The profile (what the UI shows) grants creation, the token (what the server checks) does not.
    { uid: DENIED, role: 'subUser', permissions: { ...productPerms, canViewSuppliers: true } },
    { uid: NOSUP, role: 'subUser', permissions: productPerms },
  ]);
  await asAdmin(env, (fs: Firestore) => setDoc(doc(fs, tp(T, 'lists', 'categories')), { names: ['Accessories'] }));
  await createUser({ uid: T, tenantId: T, role: 'owner' });
  await createUser({ uid: DENIED, tenantId: T, role: 'subUser', perms: { canViewProducts: true } });
  await createUser({ uid: NOSUP, tenantId: T, role: 'subUser', perms: productPerms });

  writeFileSync(IMAGE, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
  execSync(`npx vite build --mode emulator --outDir "${OUT_DIR}" --emptyOutDir`, { stdio: 'ignore' });
  preview = spawn(`npx vite preview --mode emulator --outDir "${OUT_DIR}" --port 4175 --strictPort`, { shell: true, stdio: 'ignore' });
  await poll(() => fetch(APP + '/sw.js').then((r) => r.ok), 30_000, 'preview');

  rmSync(PROFILE, { recursive: true, force: true });
  spawn(CHROME, ['--headless=new', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const v = await poll(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json() as Promise<{ webSocketDebuggerUrl: string }>), 20_000, 'chrome');
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)!;
      pending.delete(msg.id);
      return msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  };
});

afterAll(async () => {
  try {
    await send('Browser.close');
  } catch {
    /* already closed */
  }
  if (preview?.pid) execSync(`taskkill /PID ${preview.pid} /T /F`, { stdio: 'ignore' });
  await env?.cleanup();
});

const categoryNames = async () => ((await readDoc(env, tp(T, 'lists', 'categories'))) as { names: string[] }).names;
const suppliersNamed = (name: string) => readWhere(env, tp(T, 'suppliers'), 'name', name);

/* ------------------------------------------------------------------ scenarios */
describe('Add Product: inline Category and Supplier creation (owner)', () => {
  let page: Page;
  let before: Record<string, unknown>;

  it('opens Add Product with real selectors ending in "+ Add new …"', async () => {
    page = await Page.open();
    await page.signIn(`${T.toLowerCase()}@test.local`);
    await page.openAddProduct();
    for (const [label, value] of PRODUCT_VALUES) await page.fill(label, value);
    await page.attachImage();
    before = await productState(page);
    expect(before.name).toBe('Inline Widget');
    expect(String(before['product-image'])).toMatch(/\.png$/);
    expect((await page.options('Category')).slice(-1)).toEqual(['__new__']);
    expect((await page.options('Supplier')).slice(-1)).toEqual(['__new__']);
  });

  it('selects an existing category and supplier', async () => {
    await page.choose('Category', 'Accessories');
    await page.choose('Supplier', 'sup1');
    expect(await page.value('Category')).toBe('Accessories');
    expect(await page.value('Supplier')).toBe('sup1');
  });

  it('category: opens an inline form with focus inside; Escape closes only that form and focus returns', async () => {
    await page.choose('Category', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    expect(await page.value('Category')).toBe('Accessories');
    await page.key('Escape');
    expect(await page.panels()).toBe(0);
    expect(await page.modalOpen()).toBe(true);
    await poll(() => page.ev(`document.activeElement === field('Category')`), 3_000, 'focus back on Category');
    expect(await productState(page)).toEqual(before);
  });

  it('category: empty name shows a validation error and creates nothing', async () => {
    await page.choose('Category', '__new__');
    await page.clickButton('^save$', 'panel()');
    await poll(async () => /This field is required/.test(await page.ev(`panel().innerText`)), 5_000, 'required error');
    expect(await page.panels()).toBe(1);
    await page.clickButton('^cancel$', 'panel()');
    expect(await page.panels()).toBe(0);
    expect(await page.modalOpen()).toBe(true);
  });

  it('category: creates a new category with Enter, selects it, keeps the form', async () => {
    await page.choose('Category', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.type('Chargers');
    await page.key('Enter');
    await poll(async () => (await page.value('Category')) === 'Chargers', 10_000, 'Chargers selected');
    expect(await page.panels()).toBe(0);
    expect(await page.modalOpen()).toBe(true);
    expect(await categoryNames()).toEqual(['Accessories', 'Chargers']);
    expect(await productState(page)).toEqual(before);
  });

  it('category: a duplicate (different case/spacing) is not created, the existing one is selected', async () => {
    await page.choose('Category', 'Accessories');
    await page.choose('Category', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.type('  chargers ');
    await page.clickButton('^save$', 'panel()', 4);
    await poll(async () => (await page.value('Category')) === 'Chargers', 10_000, 'existing selected');
    expect(await page.text()).toMatch(/already exists, so it was selected/);
    expect(await categoryNames()).toEqual(['Accessories', 'Chargers']);
  });

  it('supplier: creates a new supplier (repeated Save clicks), selects it, keeps the form', async () => {
    await page.choose('Supplier', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    expect(await page.ev(`[...panel().querySelectorAll('.field__label')].map((l) => l.textContent.replace('*', '').trim())`)).toEqual(['Name', 'Phone']);
    await page.ev(`setValue(panel().querySelectorAll('input')[0], 'Gamma Trading')`);
    await page.ev(`setValue(panel().querySelectorAll('input')[1], '71 123 456')`);
    await page.clickButton('^save$', 'panel()', 5);
    await poll(async () => (await page.panels()) === 0, 10_000, 'supplier panel closed');
    const created = await suppliersNamed('Gamma Trading');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ phone: '71123456', balanceUsdCents: 0, createdBy: T });
    const id = await page.value('Supplier');
    expect(id).not.toBe('sup1');
    expect(await page.ev(`field('Supplier').selectedOptions[0].textContent`)).toBe('Gamma Trading');
    expect(await productState(page)).toEqual(before);
  });

  it('supplier: a duplicate name is not created, the existing supplier is selected', async () => {
    const gamma = await page.value('Supplier');
    await page.choose('Supplier', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.type('SUPPLIER');
    await page.key('Enter');
    await poll(async () => (await page.value('Supplier')) === 'sup1', 10_000, 'existing supplier selected');
    expect(await page.text()).toMatch(/Supplier "Supplier" already exists/);
    expect(await suppliersNamed('SUPPLIER')).toHaveLength(0);
    await page.choose('Supplier', gamma);
  });

  it('keyboard: Tab moves from the name field to Cancel and Save inside the inline form', async () => {
    await page.choose('Category', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.key('Tab');
    expect(await page.ev(`document.activeElement.innerText.trim()`)).toBe('Cancel');
    await page.key('Tab');
    expect(await page.ev(`document.activeElement.innerText.trim()`)).toBe('Save');
    await page.key('Escape');
    expect(await page.panels()).toBe(0);
    expect(await page.modalOpen()).toBe(true);
  });

  it('finishes the product: one product with the new category, supplier and image, despite repeated Save clicks', async () => {
    const supplierId = await page.value('Supplier');
    expect(await page.value('Category')).toBe('Chargers');
    expect(await productState(page)).toEqual(before);
    await page.clickAt(`button('^save$', document.querySelector('.modal__footer'))`, 3);
    await poll(async () => !(await page.modalOpen()), 30_000, 'modal closed').catch(async (e) => {
      throw new Error(`${(e as Error).message}\n${await page.text()}`);
    });
    const products = await readWhere(env, tp(T, 'products'), 'name', 'Inline Widget');
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      category: 'Chargers',
      barcode: '9990001',
      supplierId,
      supplierName: 'Gamma Trading',
      costUsdCents: 725,
      minStock: 3,
      expiryDate: '2027-05-01',
      stock: 4,
    });
    expect((products[0] as { prices: { retail: { usdCents: number } } }).prices.retail.usdCents).toBe(1250);
    expect((products[0] as { imageUrl: string | null }).imageUrl).toBeTruthy();
  });

  it.each([1440, 1024, 768, 430, 390])('layout at %ipx: both inline forms fit, Save/Cancel visible, no nested scroll', async (width) => {
    await page.s('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : 900, deviceScaleFactor: 1, mobile: width <= 430 });
    await page.openAddProduct();
    await page.choose('Category', '__new__');
    await page.choose('Supplier', '__new__');
    const layout = await page.ev<Record<string, unknown>>(`(() => {
      const modal = document.querySelector('.modal');
      const panels = [...modal.querySelectorAll('.inline-create')];
      const buttons = panels.flatMap((p) => [...p.querySelectorAll('button')]);
      const visible = buttons.every((b) => {
        b.scrollIntoView({ block: 'nearest' });
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      });
      return {
        panels: panels.length,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        modalOverflow: [...modal.querySelectorAll('*')].some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible'),
        panelWiderThanModal: panels.some((p) => p.getBoundingClientRect().right > modal.getBoundingClientRect().right + 1 || p.getBoundingClientRect().left < modal.getBoundingClientRect().left - 1),
        nestedScroll: panels.some((p) => p.scrollHeight > p.clientHeight + 1),
        buttonsVisible: visible && buttons.length === 4,
      };
    })()`);
    expect(layout).toEqual({ panels: 2, pageOverflow: false, modalOverflow: false, panelWiderThanModal: false, nestedScroll: false, buttonsVisible: true });
    await page.key('Escape');
    await page.key('Escape');
  });
});

describe('Add Product: server-side permission checks still apply', () => {
  it('a denied category / supplier shows a friendly error, keeps the inline form and the product form, creates nothing', async () => {
    const page = await Page.open();
    await page.signIn(`${DENIED.toLowerCase()}@test.local`);
    await page.openAddProduct();
    await page.fill('Name', 'Denied Widget');
    await page.fill('Retail ($)', '9.99');
    const before = await productState(page);

    await page.choose('Category', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.type('Forbidden');
    await page.clickButton('^save$', 'panel()');
    await poll(async () => /You do not have permission to do this/.test(await page.ev(`panel()?.innerText ?? ''`)), 15_000, 'category denied message');
    expect(await page.ev(`panel().querySelector('input').value`)).toBe('Forbidden');
    expect(await page.modalOpen()).toBe(true);
    expect(await productState(page)).toEqual(before);
    expect(await categoryNames()).not.toContain('Forbidden');
    expect(await page.focusInPanel()).toBe(true);
    // Escape with focus elsewhere in the modal still closes the inline form first, not the modal.
    await page.ev(`field('Name').focus()`);
    await page.key('Escape');
    expect(await page.panels()).toBe(0);
    expect(await page.modalOpen()).toBe(true);

    await page.choose('Supplier', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.type('Ghost Supplier');
    await page.key('Enter');
    await poll(async () => /You do not have permission to do this/.test(await page.ev(`panel()?.innerText ?? ''`)), 15_000, 'supplier denied message');
    expect(await page.panels()).toBe(1);
    expect(await page.modalOpen()).toBe(true);
    expect(await productState(page)).toEqual(before);
    expect(await suppliersNamed('Ghost Supplier')).toHaveLength(0);
  });

  it('a user without supplier access is not offered "+ Add new supplier" but can still add a category', async () => {
    const page = await Page.open();
    await page.signIn(`${NOSUP.toLowerCase()}@test.local`);
    await page.openAddProduct();
    expect(await page.options('Supplier')).not.toContain('__new__');
    await page.choose('Category', '__new__');
    await poll(() => page.focusInPanel(), 5_000, 'focus in panel');
    await page.type('Cashier Category');
    await page.key('Enter');
    await poll(async () => (await page.value('Category')) === 'Cashier Category', 10_000, 'category selected');
    expect(await categoryNames()).toContain('Cashier Category');
  });

  it('no uncaught page exceptions', () => {
    expect(exceptions).toEqual([]);
  });
});
