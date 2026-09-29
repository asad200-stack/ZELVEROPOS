// Copies the single source of truth for Firebase isolation into the functions package so the
// deployed code (which only contains functions/) can block the old project at cold start.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../config/firebase-isolation.json');
const target = resolve(here, '../isolation.json');

if (!existsSync(source)) {
  console.error(`[functions] missing ${source}`);
  process.exit(1);
}
copyFileSync(source, target);
console.info('[functions] isolation config copied');
