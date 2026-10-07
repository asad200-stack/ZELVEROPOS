#!/usr/bin/env node
/**
 * Browser test of the e-mail flows against the LOCAL emulators only (no real e-mail is ever sent):
 * resend cooldown, reload persistence, rate-limit handling, "I have verified", and the /auth/action
 * handler (verifyEmail, resetPassword, single use). Run through:
 *   npm run test:auth-email
 * which wraps it in `firebase emulators:exec --project demo-zelvero`.
 */
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'demo-zelvero';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Run inside `firebase emulators:exec` (auth emulator not detected).');
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const OOB = `${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`;
const APP = 'http://localhost:4174';
const OUT_DIR = join(tmpdir(), 'zelvero-email-e2e-dist');
const PROFILE = join(tmpdir(), 'zelvero-email-e2e-chrome');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pw = () => `E2e-${randomBytes(9).toString('base64url')}`;
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
      last = v;
    } catch (e) {
      last = e.message;
    }
    await sleep(200);
  }
  throw new Error(`timeout: ${label} (last: ${JSON.stringify(last)})`);
}
const oob = async (email, type) => ((await (await fetch(OOB)).json()).oobCodes ?? []).filter((c) => c.email === email && c.requestType === type);
const rest = async (path, body) => (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

/* -------------------------------------------------------------- browser plumbing */
let ws;
let seq = 0;
const pending = new Map();
const events = [];
let sendOobRequests = 0;
let fakeRateLimit = false;
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, fail) => pending.set(id, { ok, fail }));
}
let session;
const s = (method, params) => send(method, params, session);
async function ev(expression) {
  const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function go(path) {
  await s('Page.navigate', { url: APP + path });
  await poll(() => ev(`document.readyState === 'complete' && !!document.querySelector('#root > *') && !document.querySelector('.page-loader, .spinner--page')`), 20_000, `render ${path}`);
  await sleep(700);
}
const text = () => ev(`document.body.innerText`);
const path = () => ev('location.pathname');
async function click(re) {
  const p = await poll(() => ev(`(() => { const re = new RegExp(${JSON.stringify(re)}, 'i'); const el = [...document.querySelectorAll('button')].find((b) => re.test(b.innerText.trim()) && b.getBoundingClientRect().width); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: el.disabled }; })()`), 10_000, `button ${re}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return p;
}
const buttonState = (re) => ev(`(() => { const re = new RegExp(${JSON.stringify(re)}, 'i'); const b = [...document.querySelectorAll('button')].find((x) => re.test(x.innerText.trim())); return b ? { disabled: b.disabled, label: b.innerText.trim() } : null; })()`);
async function fill(name, value) {
  await ev(`(() => { const el = document.querySelector('input[name=${name}]'); el.focus(); el.select(); return true; })()`);
  await s('Input.insertText', { text: value });
}

async function launch() {
  rmSync(PROFILE, { recursive: true, force: true });
  spawn(CHROME, ['--headless=new', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const v = await poll(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()), 20_000, 'chrome');
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      return msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    }
    const p = msg.params ?? {};
    if (msg.method === 'Fetch.requestPaused') {
      if (p.request.method !== 'POST') return send('Fetch.continueRequest', { requestId: p.requestId }, msg.sessionId);
      sendOobRequests++;
      if (fakeRateLimit) {
        const body = Buffer.from(JSON.stringify({ error: { code: 400, message: 'TOO_MANY_ATTEMPTS_TRY_LATER', errors: [{ message: 'TOO_MANY_ATTEMPTS_TRY_LATER', domain: 'global', reason: 'invalid' }] } })).toString('base64');
        send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 400, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body }, msg.sessionId);
      } else send('Fetch.continueRequest', { requestId: p.requestId }, msg.sessionId);
    } else if (msg.method === 'Runtime.exceptionThrown') events.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') events.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)}`);
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  for (const d of ['Page.enable', 'Runtime.enable']) await s(d);
  await s('Fetch.enable', { patterns: [{ urlPattern: '*accounts:sendOobCode*', requestStage: 'Request' }] });
}

/* -------------------------------------------------------------- scenario */
async function run() {
  execSync(`npx vite build --mode emulator --outDir "${OUT_DIR}" --emptyOutDir`, { stdio: 'ignore' });
  const preview = spawn(`npx vite preview --mode emulator --outDir "${OUT_DIR}" --port 4174 --strictPort`, { shell: true, stdio: 'ignore' });
  try {
    await poll(() => fetch(APP + '/sw.js').then((r) => r.ok), 30_000, 'preview');
    await launch();
    const email = `owner-${Date.now()}@test.local`;
    const password = pw();

    console.log('\n=== Signup sends exactly one verification e-mail');
    await go('/signup');
    await fill('fullName', 'E2E Owner');
    await fill('storeName', 'E2E Store');
    await fill('subdomain', `e2e-${Date.now().toString(36)}`);
    await fill('phone', '70123456');
    await fill('email', email);
    await fill('password', password);
    await fill('confirmPassword', password);
    await click('^create an account$');
    await poll(async () => (await path()) === '/verify-email', 30_000, 'verify page');
    await sleep(1000);
    check((await oob(email, 'VERIFY_EMAIL')).length === 1, 'signup sent one verification e-mail', (await oob(email, 'VERIFY_EMAIL')).length);

    console.log('\n=== Resend cooldown');
    const first = await buttonState('request another|resend');
    check(first?.disabled && /\d+s/.test(first.label), 'resend is disabled with a visible countdown right after signup', first);
    for (let i = 0; i < 10; i++) await click('request another|resend');
    await sleep(800);
    check((await oob(email, 'VERIFY_EMAIL')).length === 1 && sendOobRequests === 1, '10 clicks during the cooldown send nothing', { emails: (await oob(email, 'VERIFY_EMAIL')).length, requests: sendOobRequests });
    await sleep(2200);
    const ticking = await buttonState('request another|resend');
    check(Number(/\d+/.exec(ticking.label)[0]) < Number(/\d+/.exec(first.label)[0]), 'countdown ticks down', `${first.label} -> ${ticking.label}`);
    await go('/verify-email');
    const afterReload = await buttonState('request another|resend');
    check(afterReload?.disabled && Number(/\d+/.exec(afterReload.label)[0]) <= Number(/\d+/.exec(ticking.label)[0]), 'a reload does not reset the cooldown', afterReload);
    check(sendOobRequests === 1, 'loading the verify page never sends an e-mail by itself', sendOobRequests);

    await ev(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('zelvero.emailCooldown.verify.')) localStorage.setItem(k, JSON.stringify({ until: Date.now() - 1, rateLimited: false })); return true; })()`);
    await go('/verify-email');
    check(!(await buttonState('resend'))?.disabled, 'after the cooldown has elapsed the button is enabled again');
    await click('^resend');
    await poll(async () => /Verification email sent\. Please check your inbox and spam folder\./.test(await text()), 10_000, 'sent message');
    check(true, 'success message: "Verification email sent. Please check your inbox and spam folder."');
    for (let i = 0; i < 5; i++) await click('request another|resend');
    await sleep(800);
    check((await oob(email, 'VERIFY_EMAIL')).length === 2 && sendOobRequests === 2, 'exactly one more e-mail after the cooldown, none for the extra clicks', { emails: (await oob(email, 'VERIFY_EMAIL')).length, requests: sendOobRequests });

    console.log('\n=== Firebase rate limit (TOO_MANY_ATTEMPTS_TRY_LATER injected at the network layer)');
    fakeRateLimit = true;
    await ev(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('zelvero.emailCooldown.verify.')) localStorage.setItem(k, JSON.stringify({ until: Date.now() - 1, rateLimited: false })); return true; })()`);
    await go('/verify-email');
    const before = sendOobRequests;
    await click('^resend');
    await poll(async () => /Too many emails were requested/.test(await text()), 10_000, 'rate-limit message');
    const limited = await buttonState('request another|resend');
    const secs = Number(/\d+/.exec(limited?.label ?? '')?.[0] ?? 0);
    check(limited?.disabled && secs > 590 && secs <= 600, 'friendly rate-limit message and a 10-minute back-off', limited);
    for (let i = 0; i < 5; i++) await click('request another|resend');
    await go('/verify-email');
    check(sendOobRequests === before + 1, 'after the rate limit no further request reaches Firebase (clicks and reload)', { requests: sendOobRequests - before });
    check(/Too many emails were requested/.test(await text()), 'the rate-limit notice survives a reload');
    fakeRateLimit = false;

    console.log('\n=== "I have verified my email"');
    await click('i have verified');
    await poll(async () => /not verified yet/i.test(await text()), 10_000, 'still pending');
    check((await path()) === '/verify-email', 'before verifying: stays on the page with "not verified yet"');
    const codes = await oob(email, 'VERIFY_EMAIL');
    const applied = await rest('accounts:update', { oobCode: codes[codes.length - 1].oobCode });
    check(applied.emailVerified === true, 'verification link applied out of band (as if opened on a phone)');
    await click('i have verified');
    await poll(async () => (await path()) !== '/verify-email', 15_000, 'leave verify page');
    check(await ev(`(async () => { const k = Object.keys(localStorage).find((x) => x.startsWith('firebase:authUser')); return !!k && JSON.parse(localStorage.getItem(k)).emailVerified === true; })()`), 'one click refreshes the session: emailVerified is true and the app moves on', await path());

    console.log('\n=== /auth/action handler');
    const usedCode = codes[codes.length - 1].oobCode;
    await go(`/auth/action?mode=verifyEmail&oobCode=${usedCode}&apiKey=demo`);
    check(/can no longer be used/i.test(await text()), 'a used verification link is rejected (single use)');
    check((await ev('location.search')) === '', 'the one-time code is removed from the address bar');

    const second = `second-${Date.now()}@test.local`;
    const su = await rest('accounts:signUp', { email: second, password: pw(), returnSecureToken: true });
    await rest('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: su.idToken });
    const [code2] = await oob(second, 'VERIFY_EMAIL');
    await go(`/auth/action?mode=verifyEmail&oobCode=${code2.oobCode}&apiKey=demo&continueUrl=${encodeURIComponent('https://evil.example/x')}`);
    await poll(async () => /Email verified/.test(await text()), 10_000, 'verified view');
    const looked = await rest('accounts:lookup', { idToken: su.idToken });
    check(looked.users?.[0]?.emailVerified === true, 'verifyEmail link through /auth/action verifies the account');
    await click('^continue$');
    await sleep(800);
    check((await ev('location.origin')) === APP, 'an external continueUrl is ignored (no open redirect)', await ev('location.href'));

    console.log('\n=== Password reset through /auth/action');
    await go('/');
    await click('sign out');
    await poll(async () => (await path()) === '/login', 10_000, 'signed out');
    await go('/forgot-password');
    await fill('email', email);
    await click('send|reset');
    await poll(async () => /If an account exists/i.test(await text()), 10_000, 'reset sent');
    check((await oob(email, 'PASSWORD_RESET')).length === 1, 'one password-reset e-mail sent');
    await go('/forgot-password');
    const resetBtn = await buttonState('request another|send');
    check(resetBtn?.disabled && /\d+s/.test(resetBtn.label), 'reset request is also on a cooldown after reload', resetBtn);
    const [reset] = await oob(email, 'PASSWORD_RESET');
    await go(`/auth/action?mode=resetPassword&oobCode=${reset.oobCode}&apiKey=demo`);
    await poll(async () => /Choose a new password/.test(await text()), 10_000, 'reset form');
    check((await text()).includes(email), 'reset form names the account');
    const newPassword = pw();
    await fill('password', newPassword);
    await fill('confirmPassword', newPassword);
    await click('save new password');
    await poll(async () => /Password changed/.test(await text()), 10_000, 'reset done');
    const signIn = await rest('accounts:signInWithPassword', { email, password: newPassword, returnSecureToken: true });
    const oldSignIn = await rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });
    check(!!signIn.idToken && !oldSignIn.idToken, 'new password works, old password no longer does');
    await go(`/auth/action?mode=resetPassword&oobCode=${reset.oobCode}&apiKey=demo`);
    check(/can no longer be used/i.test(await text()), 'a used reset link is rejected (single use)');
    await go('/auth/action?mode=signIn&oobCode=whatever');
    check(/can no longer be used/i.test(await text()), 'unsupported or malformed links get the branded error page');

    console.log('\n=== Page errors');
    const unexpected = events.filter((e) => !/auth\/(too-many-requests|invalid-action-code|expired-action-code)|Failed to load resource/.test(e));
    check(!unexpected.length, 'no unexpected exceptions or console errors', unexpected);
  } finally {
    try {
      await send('Browser.close');
    } catch {
      /* closed */
    }
    execSync(`taskkill /PID ${preview.pid} /T /F`, { stdio: 'ignore' });
  }
}

try {
  await run();
} catch (e) {
  failures++;
  console.log(`FAIL  ${e.message}`);
}
console.log(failures ? `\n${failures} FAILED` : '\nauth e-mail e2e: all checks passed');
process.exit(failures ? 1 : 0);
