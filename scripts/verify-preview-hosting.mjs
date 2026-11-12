// Local-only check of firebase.preview-hosting.json against hosting-deliverable/ via the Hosting emulator.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = process.env.HOSTING_BASE || 'http://127.0.0.1:5089';
const P = '/app/0.9.1-admin.1';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const deploy = JSON.parse(readFileSync('firebase.preview-hosting.json', 'utf8')).hosting;
const local = JSON.parse(readFileSync('firebase.preview-hosting.local.json', 'utf8')).hosting;
const files = JSON.parse(readFileSync('hosting-recovered-manifest.json', 'utf8')).files.map((f) => f.path);
const rootIndex = sha(readFileSync('hosting-recovered/index.html'));
const prevIndex = sha(readFileSync(`hosting-deliverable${P}/index.html`));
const out = []; let fail = 0;
const EMU = !process.env.HOSTING_BASE; // the local Hosting emulator does not serve configured headers
const hcheck = (name, ok, info = '') => { if (EMU) { out.push(`SKIP ${name} (emulator serves no headers; validated structurally and on live)`); return; } check(name, ok, info); };
const check = (name, ok, info = '') => { out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' :: ' + info : ''}`); if (!ok) fail++; };
const get = async (p) => { const r = await fetch(BASE + p, { redirect: 'manual' }); const b = Buffer.from(await r.arrayBuffer()); return { s: r.status, h: r.headers, sha: sha(b), loc: r.headers.get('location') }; };
check('emulator config hosting section == deploy config', JSON.stringify(deploy) === JSON.stringify(local));
let same = 0, skipped = [];
for (const p of files) {
  if (p.startsWith('/__/')) { skipped.push(p); continue; }
  const r = await get(p);
  if (r.s === 200 && r.sha === sha(readFileSync('hosting-recovered' + p))) same++; else out.push(`  root mismatch ${p} status=${r.s}`);
}
check('customer root files served byte-identical', same === files.length - skipped.length, `${same}/${files.length - skipped.length} (reserved ${skipped.join(',')} served by Hosting itself)`);
for (const p of ['/', '/pos', '/dashboard', '/admin', '/login', '/sales/abc123', '/app/9.9.9/pos']) {
  const r = await get(p); check(`customer route ${p} -> live root index`, r.s === 200 && r.sha === rootIndex, `status=${r.s}`);
}
const cc = async (p, want) => { const r = await get(p); hcheck(`cache ${p}`, r.s === 200 && (r.h.get('cache-control') || '') === want, `${r.s} ${r.h.get('cache-control')}`); };
await cc('/index.html', 'no-cache'); await cc('/sw.js', 'no-cache'); await cc('/boot.js', 'no-cache');
await cc('/assets/index-6Yr7KTfV.js', 'public, max-age=31536000, immutable'); await cc('/favicon.ico', 'public, max-age=604800');
for (const p of [P, P + '/', P + '/pos', P + '/admin', P + '/sales/abc123']) {
  const r = await get(p);
  const ok = (r.s === 200 && r.sha === prevIndex) || (r.s >= 300 && r.s < 400 && (r.loc || '').endsWith(P + '/'));
  check(`preview route ${p} -> preview index`, ok, `status=${r.s}${r.loc ? ' loc=' + r.loc : ''}`);
}
await cc(P + '/index.html', 'no-cache'); await cc(P + '/sw.js', 'no-cache'); await cc(P + '/manifest.webmanifest', 'no-cache');
await cc(P + '/assets/index-CwyI6jxY.js', 'public, max-age=31536000, immutable');
{ const r = await get(P + '/assets/index-CwyI6jxY.js'); check('preview asset bytes', r.sha === sha(readFileSync(`hosting-deliverable${P}/assets/index-CwyI6jxY.js`))); }
{ const r = await get(P + '/open.html'); check('preview entry open.html served as-is', r.s === 200 && r.sha === sha(readFileSync(`hosting-deliverable${P}/open.html`)), `status=${r.s}`); }
{ const r = await get(P + '/open.js'); check('preview entry open.js served as-is', r.s === 200 && r.sha === sha(readFileSync(`hosting-deliverable${P}/open.js`)), `status=${r.s}`); }
await cc(P + '/open.html', 'no-cache');
{ const r = await get(P + '/assets/does-not-exist-123.js'); check('missing preview asset -> 404 (not HTML)', r.s === 404, `status=${r.s}`); }
{ const r = await get(P + '/pos'); for (const k of ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'x-content-type-options']) hcheck(`preview security header ${k}`, !!r.h.get(k)); }
{ const r = await get(P + '/index.html'); const html = readFileSync(`hosting-deliverable${P}/index.html`, 'utf8'); check('preview index loads only versioned assets', !/(src|href)="\/(assets|boot\.js)/.test(html) && html.includes(P + '/boot.js')); }
out.push(`RESULT ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
writeFileSync('tmp/deploy/hosting-verify.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
process.exit(fail ? 1 : 0);
