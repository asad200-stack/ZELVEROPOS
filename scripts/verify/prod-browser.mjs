#!/usr/bin/env node
/**
 * Production browser checks on https://zelvoropos.web.app with a fresh, dedicated Chrome profile
 * (never the user's own profile, never an embedded editor browser), driven over the DevTools protocol.
 *   node scripts/verify/prod-browser.mjs public     signed-out screens, service worker, 404, responsive, console
 * Evidence (screenshots, console/network log) goes to %TEMP%/zelvero-stage5. Nothing here signs in.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = 'https://zelvoropos.web.app';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = join(tmpdir(), 'zelvero-prod-chrome');
const OUT = join(tmpdir(), 'zelvero-stage5');
const PORT = 9334;
const WIDTHS = [
  { w: 1440, h: 900, mobile: false },
  { w: 1024, h: 768, mobile: false },
  { w: 768, h: 1024, mobile: true },
  { w: 430, h: 932, mobile: true },
  { w: 390, h: 844, mobile: true },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
async function poll(fn, ms, label) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`timeout: ${label}${last ? ' (' + last.message + ')' : ''}`);
}

function cdp(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message));
      else ok(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
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
        on: (fn) => listeners.push(fn),
        close: () => ws.close(),
      });
  });
}

const events = [];
let browser;
let page;

async function launch() {
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  spawn(CHROME, [
    '--headless=new',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });
  const v = await poll(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()), 20_000, 'chrome');
  browser = await cdp(v.webSocketDebuggerUrl);
  browser.on((msg) => {
    const p = msg.params ?? {};
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'warn'].includes(p.type)) {
      events.push({ kind: `console.${p.type}`, at: page?.where, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400) });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      events.push({ kind: 'exception', at: page?.where, text: (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 400) });
    } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level)) {
      events.push({ kind: `log.${p.entry.level}`, at: page?.where, text: `${p.entry.source}: ${p.entry.text}`.slice(0, 400), url: p.entry.url });
    } else if (msg.method === 'Network.loadingFailed' && !p.canceled) {
      events.push({ kind: 'network.failed', at: page?.where, text: `${p.errorText} ${page?.requests.get(p.requestId) ?? ''}` });
    } else if (msg.method === 'Network.requestWillBeSent') {
      page?.requests.set(p.requestId, `${p.request.method} ${p.request.url.slice(0, 160)}`);
    } else if (msg.method === 'Network.responseReceived' && p.response.status >= 400) {
      events.push({ kind: `network.${p.response.status}`, at: page?.where, text: `${page?.requests.get(p.requestId) ?? p.response.url}` });
    }
  });
}

async function openTab() {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  for (const d of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await s(d);
  page = { s, targetId, where: 'about:blank', requests: new Map() };
}
async function ev(expression) {
  const r = await page.s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function go(path) {
  page.where = path;
  await page.s('Page.navigate', { url: APP + path });
  await poll(() => ev(`document.readyState === 'complete' && !!document.querySelector('#root > *')`), 30_000, `render ${path}`);
  await sleep(800);
}
async function setWidth({ w, h, mobile }) {
  await page.s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(400);
}
async function shot(name) {
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}
/** Elements wider than the viewport or clipped off-screen horizontally (ignores intentional scrollers). */
const LAYOUT = `(() => {
  const vw = document.documentElement.clientWidth;
  const off = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let p = el.parentElement, scroller = false;
    while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scroller = true; break; } p = p.parentElement; }
    if (!scroller && (r.right > vw + 1 || r.left < -1)) off.push((el.className || el.tagName).toString().slice(0, 50));
  }
  return { docOverflow: document.documentElement.scrollWidth - vw, offscreen: [...new Set(off)].slice(0, 6) };
})()`;
const visibleText = () => ev(`document.querySelector('#root').innerText.replace(/\\s+/g, ' ').trim().slice(0, 160)`);

async function typeInto(selector, text) {
  await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); return true; })()`);
  await page.s('Input.insertText', { text });
}

async function publicPhase() {
  await launch();
  await openTab();

  console.log('\n=== Signed-out routes');
  await go('/');
  check((await ev('location.pathname')) === '/login', '/ (signed out) lands on /login', await ev('location.pathname'));
  for (const path of ['/pos', '/products', '/sales', '/settings', '/admin', '/dashboard']) {
    await go(path);
    const at = await ev('location.pathname');
    check(at === '/login', `${path} is protected (redirects to /login)`, at);
  }
  await go('/signup');
  check((await ev('location.pathname')) === '/signup' && (await ev(`!!document.querySelector('form')`)), '/signup renders the signup form');
  await go('/forgot-password');
  check((await ev(`!!document.querySelector('input[type=email]')`)), '/forgot-password renders');
  await go('/no-such-page');
  const notFound = await visibleText();
  check((await ev('location.pathname')) === '/no-such-page' && /404|not found|غير موجود/i.test(notFound), "unknown route shows the app's 404 page", notFound);

  console.log('\n=== Service worker');
  await go('/login');
  const sw = await poll(() => ev(`navigator.serviceWorker.getRegistration().then(r => r && r.active && r.active.state === 'activated' ? { scope: r.scope, script: r.active.scriptURL } : null)`), 30_000, 'sw activated');
  check(sw.scope === APP + '/' && sw.script === APP + '/sw.js', 'service worker installed and activated', sw);
  const ver = await ev(`new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = (e) => res(e.data); navigator.serviceWorker.controller ? navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [c.port2]) : navigator.serviceWorker.ready.then(r => r.active.postMessage({ type: 'GET_VERSION' }, [c.port2])); })`);
  const caches = await ev(`caches.keys().then(async (ks) => Promise.all(ks.map(async (k) => [k, (await (await caches.open(k)).keys()).length])))`);
  check(ver.files === 51 && caches.some(([k, n]) => k.endsWith(ver.version) && n === 51), 'shell cache holds all 51 precached files', { ver, caches });
  await go('/login');
  check(await ev('!!navigator.serviceWorker.controller'), 'page is controlled by the service worker after reload');
  const mf = await ev(`fetch('/manifest.webmanifest').then(r => r.json()).then(m => ({ name: m.name, icons: m.icons.length }))`);
  check(mf.name === 'Zelvero POS' && mf.icons === 3, 'manifest loads in the page', mf);
  const icons = await ev(`Promise.all([...document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon]')].map(l => fetch(l.href).then(r => l.getAttribute('href') + ' ' + r.status)))`);
  check(icons.every((i) => i.endsWith(' 200')), 'favicon, 32px icon and apple-touch-icon load', icons);

  console.log('\n=== Wrong password (TEST owner e-mail, random wrong password)');
  await typeInto('input[type=email]', 'asad28486+zelvero-test@gmail.com');
  await typeInto('input[autocomplete=current-password]', `wrong-${Math.random().toString(36).slice(2)}-X1`);
  await ev(`document.querySelector('form button[type=submit]').click()`);
  const err = await poll(async () => {
    const t = await ev(`document.body.innerText`);
    return /incorrect email or password|غير صحيحة|too many/i.exec(t)?.[0] ?? null;
  }, 20_000, 'login error');
  check(/incorrect email or password|غير صحيحة/i.test(err) && (await ev('location.pathname')) === '/login', 'wrong password shows the generic credential error and stays signed out', err);
  check(!(await ev(`Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(k => k.startsWith('firebase:authUser'))`)), 'no auth session stored after the failed login');

  console.log('\n=== Responsive (signed-out screens)');
  for (const size of WIDTHS) {
    await setWidth(size);
    for (const path of ['/login', '/signup']) {
      await go(path);
      const l = await ev(LAYOUT);
      await shot(`public-${path.slice(1)}-${size.w}`);
      check(l.docOverflow <= 0 && !l.offscreen.length, `${path} @ ${size.w}px: no horizontal overflow`, l);
    }
  }
  await page.s('Emulation.clearDeviceMetricsOverride');

  console.log('\n=== Console and network (signed-out session)');
  for (const e of events) console.log(`  ${e.kind.padEnd(16)} ${String(e.at).padEnd(16)} ${e.text}`);
  if (!events.length) console.log('  none');
  writeFileSync(join(OUT, 'public-events.json'), JSON.stringify(events, null, 1));
}

try {
  const phase = process.argv[2];
  if (phase !== 'public') throw new Error('usage: prod-browser.mjs public');
  await publicPhase();
} catch (e) {
  failures++;
  console.log(`FAIL  ${e.message}`);
} finally {
  try {
    await browser?.send('Browser.close');
  } catch {
    /* already closed */
  }
  browser?.close();
  await sleep(1500);
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object CommandLine -like '*zelvero-prod-chrome*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore' });
  } catch {
    /* none left */
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}
