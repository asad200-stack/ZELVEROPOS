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
import { checkFirebaseTargets } from './firebase-guard.mjs';

const ONLY = {
  all: 'hosting,firestore:rules,firestore:indexes,storage,functions',
  hosting: 'hosting',
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

const { problems, active } = checkFirebaseTargets();
if (problems.length) {
  console.error('\n\u26D4  Deployment blocked by the Firebase isolation guard:');
  problems.forEach((p) => console.error('   - ' + p));
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nAbout to deploy [${ONLY[target]}] to Firebase project: ${active}`);
const answer = (await rl.question(`Type the project id (${active}) to confirm: `)).trim();
rl.close();
if (answer !== active) {
  console.log('Confirmation did not match. Deployment cancelled.');
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

if (ONLY[target].includes('hosting')) run('npm run build');
run(`npx firebase-tools deploy --only ${ONLY[target]} --project ${active}`);
console.log(`\nDeployed [${ONLY[target]}] to ${active}.`);
