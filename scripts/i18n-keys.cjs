/**
 * Lists translation keys referenced in src/ that are missing from src/i18n/en.ts.
 * Usage: node scripts/i18n-keys.cjs [--all]
 */
const fs = require('fs');
const path = require('path');

const NAMESPACES =
  'common|error|config|validation|auth|account|nav|sync|settings|receipt|pos|sales|returns|products|movement|expiry|customers|ledger|suppliers|purchases|date|cash|dashboard|reports|users|perm|admin';
const RE = new RegExp(`['\`]((?:${NAMESPACES})\\.[A-Za-z0-9_.]+(?:\\$\\{[^}]+\\})?)['\`]`, 'g');

function read(p) {
  const buf = fs.readFileSync(p);
  return buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
}

const used = new Map();
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/i18n[\\/](en|ar)\.ts$/.test(p)) {
      for (const m of read(p).matchAll(RE)) {
        if (!used.has(m[1])) used.set(m[1], new Set());
        used.get(m[1]).add(path.relative('src', p));
      }
    }
  }
}
walk('src');

const enPath = path.join('src', 'i18n', 'en.ts');
const defined = new Set();
if (fs.existsSync(enPath)) for (const m of read(enPath).matchAll(/^\s*'([^']+)':/gm)) defined.add(m[1]);

const all = process.argv.includes('--all');
const rows = [...used.keys()].sort().filter((k) => all || (!k.includes('${') && !defined.has(k)));
for (const k of rows) console.log(`${k}  <- ${[...used.get(k)].join(', ')}`);
console.error(`${rows.length} ${all ? 'used' : 'missing'} keys`);
