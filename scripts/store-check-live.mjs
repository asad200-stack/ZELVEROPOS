#!/usr/bin/env node
/**
 * READ-ONLY. Confirms the live site's root files still match the local hosting-release/ (so nobody
 * else deployed since), before a new Hosting deploy built from it. Exit 0 = same, 1 = different.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
let same = true;
// The tree pages listed in the local release.json, plus /move.js once every store was moved (1.0.0).
const trees = JSON.parse(readFileSync('hosting-release/release.json', 'utf8')).trees ?? [];
const paths = ['/index.html', '/boot.js', '/release.json', ...trees.map((t) => `/app/${t}/index.html`)];
if (existsSync('hosting-release/move.js')) paths.push('/move.js');
for (const path of paths) {
  const res = await fetch(`https://zelvoropos.web.app${path}?check=${Date.now()}`, { cache: 'no-store' });
  const live = Buffer.from(await res.arrayBuffer());
  const local = readFileSync(`hosting-release${path}`);
  const ok = res.status === 200 && sha(live) === sha(local);
  console.log(`${ok ? 'same' : 'DIFFERENT'} ${path}`);
  if (!ok) same = false;
}
process.exit(same ? 0 : 1);
