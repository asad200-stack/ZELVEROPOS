#!/usr/bin/env node
/**
 * Staging Hosting + additive Functions + rules.
 * Targets only the configured staging project and its POS hosting site. Never deploys production Hosting.
 * Does not create a 1.0.0 freeze or assign customer stores.
 */
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { checkFirebaseTargets, loadIsolationConfig } from './firebase-guard.mjs';

const { problems, active } = checkFirebaseTargets({ role: 'staging' });
if (problems.length) {
  console.error('\nDeployment blocked by the Firebase isolation guard:');
  problems.forEach((p) => console.error('   - ' + p));
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nStaging deploy to ${active}: hosting:staging + functions + firestore:rules`);
console.log('Production Hosting (zelvoropos.web.app) will NOT be updated.');
const answer = (await rl.question(`Type the project id (${active}) to confirm: `)).trim();
rl.close();
if (answer !== active) {
  console.log('Cancelled.');
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

run('node scripts/assemble-release.mjs');
run(`npx firebase-tools deploy --only hosting:staging,functions,firestore:rules --project ${active}`);
console.log(`\nStaging POS site: ${loadIsolationConfig().stagingHostingSites?.pos || active}`);
console.log('No production stores were assigned a new version.');
