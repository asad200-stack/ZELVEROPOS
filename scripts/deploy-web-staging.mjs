#!/usr/bin/env node
/**
 * Marketing website to the configured staging marketing site only.
 * Never deploys POS production, POS staging, Functions, rules, or indexes.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkFirebaseTargets, loadIsolationConfig, marketingBundleProblems, marketingDeployProblems } from './firebase-guard.mjs';

const { problems, active } = checkFirebaseTargets({ role: 'staging', requireMarketingEnv: true });
if (problems.length) {
  console.error('\nDeployment blocked by the Firebase isolation guard:');
  problems.forEach((p) => console.error('   - ' + p));
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

const scan = (dir) => {
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
};

const publicDir = 'apps/marketing/staging-dist';
const target = 'web-staging';
const deployProblems = marketingDeployProblems({
  projectId: active,
  target,
  publicDir,
  iso: loadIsolationConfig(),
});
if (deployProblems.length) {
  deployProblems.forEach((problem) => console.error(problem));
  process.exit(1);
}
execSync('node scripts/staging-build.mjs marketing', { stdio: 'inherit' });
const bundleDir = join(process.cwd(), publicDir);
scan(bundleDir);
const bundleProblems = marketingBundleProblems('staging', readBundle(bundleDir));
if (bundleProblems.length) {
  bundleProblems.forEach((problem) => console.error(problem));
  console.error('No marketing deploy was run.');
  process.exit(1);
}
execSync(`npx firebase-tools deploy --only hosting:${target} --project ${active}`, { stdio: 'inherit' });
console.log(`\nMarketing staging site: ${loadIsolationConfig().stagingHostingSites?.marketing || active}`);
console.log('POS production and POS staging were not deployed.');
