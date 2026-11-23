#!/usr/bin/env node
/**
 * Internal demo store only. Downloads the Pexels photos (Pexels License: free, commercial use)
 * chosen for the phone-shop demo into hosting-release/app/0.9.3/demo-img/, so the store page can
 * upload them into the demo store's own Storage (the site's CSP blocks loading other image hosts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IDS = [
  34624326, 40876620, 34018284, 29020349, 31059294, 30466736, 15493878, 6901037, 32218867, 6296911,
  3921819, 3825517, 3921817, 14741306, 374110, 210927, 9130515, 4379289, 31406895, 5081914,
  35921904, 17800265, 1028674, 13706809, 694424, 30466740, 30466739,
];
const OUT = join('hosting-release', 'app', '0.9.3', 'demo-img');
mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const id of IDS) {
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`FAIL ${id} ${res.status}`);
    continue;
  }
  writeFileSync(join(OUT, `${id}.jpg`), Buffer.from(await res.arrayBuffer()));
  ok++;
}
console.log(`downloaded ${ok}/${IDS.length}`);
if (ok !== IDS.length) process.exit(1);
