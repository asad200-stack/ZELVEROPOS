#!/usr/bin/env node
/** READ-ONLY. Checks the live site after each step of the 1.0.0 release. Usage: node scripts/store-verify-100.mjs tree|shell|move */
const O = 'https://zelvoropos.web.app';
const step = process.argv[2];
const get = async (p) => {
  const r = await fetch(`${O}${p}${p.includes('?') ? '&' : '?'}v=${Date.now()}`, { cache: 'no-store', redirect: 'manual' });
  return { status: r.status, body: await r.text() };
};
const fails = [];
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
if (step === 'tree' || step === 'move') {
  const t = await get('/app/1.0.0/index.html');
  expect(t.status === 200 && t.body.includes('/app/1.0.0/assets/'), '/app/1.0.0/ serves the 1.0.0 app');
  const deep = await get('/app/1.0.0/pos');
  expect(deep.status === 200 && deep.body.includes('/app/1.0.0/assets/'), '/app/1.0.0/pos serves the 1.0.0 app');
  const js = /src="(\/app\/1\.0\.0\/assets\/[^"]+\.js)"/.exec(t.body)?.[1];
  if (js) { const a = await fetch(O + js); expect(a.status === 200, `${js} loads`); } else expect(false, 'tree index has a script');
}
if (step === 'tree') {
  const old = await get('/app/0.9.3/index.html');
  expect(old.status === 200 && old.body.includes('/app/0.9.3/assets/'), '/app/0.9.3/ still serves the old app (until the move)');
}
if (step === 'shell' || step === 'move') {
  const s = await get('/s/todayslook');
  expect(s.status === 200 && s.body.includes('/app/1.0.0/assets/') && !s.body.includes('/app/0.9.3/assets/'), '/s/todayslook uses the 1.0.0 shell');
  const r = await get('/robots.txt');
  expect(r.status === 200 && r.body.includes('/s/sitemaps.xml'), '/robots.txt');
}
if (step === 'move') {
  for (const p of ['/', '/pos', '/app/0.9.3/', '/app/0.9.3/pos']) {
    const r = await get(p);
    expect(r.status === 200 && r.body.includes('/move.js'), `${p} moves to 1.0.0`);
  }
  const m = await get('/move.js');
  expect(m.status === 200 && m.body.includes("'1.0.0'"), '/move.js');
  const rel = await get('/release.json');
  expect(rel.status === 200 && JSON.parse(rel.body).trees?.join() === '1.0.0', '/release.json lists 1.0.0');
}
if (!['tree', 'shell', 'move'].includes(step)) { console.log('usage: tree|shell|move'); process.exit(2); }
process.exit(fails.length ? 1 : 0);
