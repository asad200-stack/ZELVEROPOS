#!/usr/bin/env node
/**
 * Customer Marketing site only.
 * Publishes apps/marketing/dist to hosting:marketing on the production project.
 * Never publishes the isolated staging bundle, the POS sites, Functions, or rules.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { checkFirebaseTargets, loadIsolationConfig, marketingBundleProblems, marketingDeployProblems } from './firebase-guard.mjs';

const { problems, active } = checkFirebaseTargets({ role: 'production', requireMarketingEnv: true });
if (problems.length) {
  console.error('\nDeployment blocked by the Firebase isolation guard:');
  problems.forEach((problem) => console.error('   - ' + problem));
  process.exit(1);
}

const publicDir = 'apps/marketing/dist';
const target = 'marketing';
const iso = loadIsolationConfig();
const deployProblems = marketingDeployProblems({ projectId: active, target, publicDir, iso });
if (deployProblems.length) {
  deployProblems.forEach((problem) => console.error(problem));
  process.exit(1);
}

const forbidden = ['BEGIN PRIVATE', 'service_account', 'pos-catch', 'FIREBASE_ADMIN'];
function readBundle(dir) {
  let text = '';
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) text += readBundle(p);
    else if (name.name.endsWith('.js')) text += readFileSync(p, 'utf8');
  }
  return text;
}
function scan(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) scan(p);
    else if (/\.(js|html|json|txt|map)$/.test(name.name)) {
      const text = readFileSync(p, 'utf8');
      for (const needle of forbidden) {
        if (text.includes(needle)) {
          console.error(`Secret/isolation scan failed in ${p}: ${needle}`);
          process.exit(1);
        }
      }
    }
  }
}

execSync('npm --prefix apps/marketing run build', { stdio: 'inherit' });
const bundleDir = join(process.cwd(), publicDir);
scan(bundleDir);
const bundleProblems = marketingBundleProblems('production', readBundle(bundleDir));
if (bundleProblems.length) {
  bundleProblems.forEach((problem) => console.error(problem));
  console.error('No marketing deploy was run.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nAbout to deploy hosting:${target} from ${publicDir} to ${active}.`);
console.log('POS Hosting, Functions, and rules will not be deployed.');
const answer = (await rl.question(`Type the project id (${active}) to confirm: `)).trim();
rl.close();
if (answer !== active) {
  console.log('Confirmation did not match. Deployment cancelled.');
  process.exit(1);
}

execSync(`npx firebase-tools deploy --only hosting:${target} --project ${active}`, { stdio: 'inherit' });
console.log(`\nCustomer marketing site: https://${iso.productionHostingSites?.includes('zelvero-web-staging') ? 'zelvero-web-staging.web.app' : active}`);
console.log('The isolated staging bundle was not published.');
