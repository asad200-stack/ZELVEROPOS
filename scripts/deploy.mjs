#!/usr/bin/env node
/**
 * Guarded deployment for ZELVERO POS.
 *   npm run deploy               -> hosting + rules + indexes + storage + functions
 *   npm run deploy -- hosting    -> hosting only (also: functions | rules | firestore | storage)
 *   npm run deploy -- functions:checkSignupAvailability  -> one function
 *
 * Always passes an explicit --project so the Firebase CLI never falls back to a cached/other project.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { checkFirebaseTargets, roleForDeployTarget } from './firebase-guard.mjs';
import { PRODUCTION_RELEASE_PHRASE, productionReleaseConfirmed, replacesCustomerApp } from './release-gate.mjs';

const ONLY = {
  all: 'hosting:production,firestore:rules,firestore:indexes,storage,functions',
  hosting: 'hosting:production',
  staging: 'hosting:staging',
  functions: 'functions',
  rules: 'firestore:rules,firestore:indexes,storage',
  firestore: 'firestore:rules,firestore:indexes',
  storage: 'storage',
};

const target = process.argv[2] || 'all';
const single = /^functions:([A-Za-z][A-Za-z0-9]*)$/.exec(target);
if (single) {
  let exported = [];
  try {
    const index = readFileSync('functions/lib/index.js', 'utf8');
    exported = [...index.matchAll(/^export \{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
  } catch {
    /* not built */
  }
  if (!exported.includes(single[1])) {
    console.error(`"${single[1]}" is not exported by functions/lib/index.js (run: npm --prefix functions run build).`);
    process.exit(1);
  }
  ONLY[target] = target;
} else if (!ONLY[target]) {
  console.error(`Unknown target "${target}". Use one of: ${Object.keys(ONLY).join(', ')}, functions:<name>`);
  process.exit(1);
}

const role = roleForDeployTarget(target);
const { problems, active } = checkFirebaseTargets({ role });
if (problems.length) {
  console.error('\n\u26D4  Deployment blocked by the Firebase isolation guard:');
  problems.forEach((p) => console.error('   - ' + p));
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nAbout to deploy [${ONLY[target]}] to Firebase project: ${active}`);
const answer = (await rl.question(`Type the project id (${active}) to confirm: `)).trim();
if (answer !== active) {
  rl.close();
  console.log('Confirmation did not match. Deployment cancelled.');
  process.exit(1);
}
if (replacesCustomerApp(ONLY[target])) {
  console.log('\nThis replaces the CUSTOMER production app. Internal previews go to `npm run deploy:staging` instead.');
  const release = await rl.question(`Type ${PRODUCTION_RELEASE_PHRASE} to continue: `);
  if (!productionReleaseConfirmed(ONLY[target], release)) {
    rl.close();
    console.log('Production release not confirmed. Deployment cancelled.');
    process.exit(1);
  }
}
rl.close();

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

if (role === 'staging') run('node scripts/assemble-release.mjs');
else if (ONLY[target].includes('hosting')) run('npm run build');
run(`npx firebase-tools deploy --only ${ONLY[target]} --project ${active}`);
console.log(`\nDeployed [${ONLY[target]}] to ${active}.`);
