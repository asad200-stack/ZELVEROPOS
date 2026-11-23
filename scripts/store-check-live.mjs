#!/usr/bin/env node
/**
 * READ-ONLY. Confirms the live site's root files still match the local hosting-release/ (so nobody
 * else deployed since), before a new Hosting deploy built from it. Exit 0 = same, 1 = different.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
let same = true;
for (const path of ['/index.html', '/boot.js', '/release.json', '/app/0.9.3/index.html']) {
  const res = await fetch(`https://zelvoropos.web.app${path}?check=${Date.now()}`, { cache: 'no-store' });
  const live = Buffer.from(await res.arrayBuffer());
  const local = readFileSync(`hosting-release${path}`);
  const ok = res.status === 200 && sha(live) === sha(local);
  console.log(`${ok ? 'same' : 'DIFFERENT'} ${path}`);
  if (!ok) same = false;
}
process.exit(same ? 0 : 1);
