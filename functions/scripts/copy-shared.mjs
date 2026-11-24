// Copies the pure business rules (src/domain) into the functions package so the server computes
// prices, credit, returns and supplier allocations with exactly the same code as the POS screen.
// The deployed bundle only contains functions/, so the files are copied instead of imported.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(here, '../src/shared');

const FILES = {
  'src/domain/searchKey.ts': 'searchKey.ts',
  'src/domain/money.ts': 'money.ts',
  'src/domain/pricing.ts': 'pricing.ts',
  'src/domain/cart.ts': 'cart.ts',
  'src/domain/checkout.ts': 'checkout.ts',
  'src/domain/returns.ts': 'returns.ts',
  'src/domain/inventory.ts': 'inventory.ts',
  'src/domain/suppliers.ts': 'suppliers.ts',
  'src/domain/release.ts': 'release.ts',
  'src/domain/featureRelease.ts': 'featureRelease.ts',
  'src/domain/trial.ts': 'trial.ts',
  'src/domain/onlineStore.ts': 'onlineStore.ts',
  'src/domain/storeSeo.ts': 'storeSeo.ts',
  'src/domain/onlineOrders.ts': 'onlineOrders.ts',
  'src/domain/variants.ts': 'variants.ts',
  'src/types/models.ts': 'models.ts',
  'src/constants/permissions.ts': 'permissions.ts',
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const [from, to] of Object.entries(FILES)) {
  const source = readFileSync(resolve(root, from), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/from '@\/types\/models'/g, "from './models.js'")
    .replace(/from '@\/constants\/permissions'/g, "from './permissions.js'")
    .replace(/from '\.\/([\w-]+)'/g, "from './$1.js'");
  if (/from '@\//.test(source)) {
    console.error(`[functions] ${from} imports an app-only module; keep src/domain framework-free.`);
    process.exit(1);
  }
  writeFileSync(resolve(out, to), `// GENERATED from ${from} by functions/scripts/copy-shared.mjs. Do not edit.\n${source}`);
}
console.info(`[functions] ${Object.keys(FILES).length} shared domain files copied`);
