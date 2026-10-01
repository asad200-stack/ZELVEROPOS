#!/usr/bin/env node
/**
 * Post-build check: every exported Cloud Function must be deployed to REGION, run as
 * RUNTIME_SERVICE_ACCOUNT (functions/src/config.ts) and have an instance limit. A function that
 * silently misses the global options would otherwise deploy to the SDK default region with the
 * default compute service account.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
const constant = (name) => source.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1];
const region = constant('REGION');
const runtimeAccount = constant('RUNTIME_SERVICE_ACCOUNT');
if (!region || !runtimeAccount) {
  console.error('check-regions: could not read REGION / RUNTIME_SERVICE_ACCOUNT from src/config.ts');
  process.exit(1);
}

const mod = await import(new URL('../lib/index.js', import.meta.url).href);
const problems = [];
let count = 0;
for (const [name, fn] of Object.entries(mod)) {
  const endpoint = fn?.__endpoint;
  if (!endpoint) continue;
  count++;
  const regions = endpoint.region ?? [];
  if (regions.length !== 1 || regions[0] !== region) problems.push(`${name}: region ${JSON.stringify(regions)}, expected ["${region}"]`);
  if (!endpoint.maxInstances) problems.push(`${name}: no maxInstances limit`);
  if (endpoint.serviceAccountEmail !== runtimeAccount) {
    problems.push(`${name}: service account ${JSON.stringify(endpoint.serviceAccountEmail ?? null)}, expected "${runtimeAccount}"`);
  }
}

if (!count) problems.push('no Cloud Functions found in lib/index.js');
if (problems.length) {
  console.error('check-regions: FAILED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`check-regions: ${count} functions, all in ${region}, running as ${runtimeAccount}, with an instance limit`);
