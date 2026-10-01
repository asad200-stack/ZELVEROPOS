#!/usr/bin/env node
/**
 * Firebase isolation guard for ZELVERO POS.
 *
 * Verifies that every Firebase target this repository can talk to is the NEW project and never the
 * old CATCH POS production project. Runs:
 *   - as a predeploy hook for hosting, functions, firestore and storage (see firebase.json);
 *   - from scripts/deploy.mjs before any deployment;
 *   - manually: `npm run firebase:verify`.
 *
 * Exit code 0 = safe, 1 = blocked. Flags:
 *   --hook        running inside a Firebase CLI predeploy hook (uses $GCLOUD_PROJECT)
 *   --project=ID  explicit project being targeted
 *   --emulator    only a "demo-" emulator project is acceptable
 *   --quiet       print only failures
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function parseDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

export function loadIsolationConfig() {
  return readJson(join(ROOT, 'config', 'firebase-isolation.json'));
}

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function functionsRegion() {
  const file = join(ROOT, 'functions', 'src', 'config.ts');
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').match(/export const REGION = '([a-z0-9-]+)'/)?.[1] ?? '';
}

const WEB_CONFIG_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

/** The web config must be complete, free of placeholders and describe one single project. */
function webConfigProblems(env, projectId) {
  const problems = [];
  const missing = WEB_CONFIG_KEYS.filter((k) => !env[k]);
  if (missing.length) problems.push(`Missing production web config: ${missing.join(', ')}.`);
  for (const k of WEB_CONFIG_KEYS) {
    if (/^demo-|REPLACE|your-|^0+$|:0+:web:/i.test(env[k] || '')) problems.push(`${k} looks like a placeholder or emulator value.`);
  }
  const sender = env.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
  if (sender && !/^\d{6,}$/.test(sender)) problems.push('VITE_FIREBASE_MESSAGING_SENDER_ID must be the numeric project number.');
  if (env.VITE_FIREBASE_APP_ID && sender && !env.VITE_FIREBASE_APP_ID.startsWith(`1:${sender}:web:`)) {
    problems.push('VITE_FIREBASE_APP_ID does not belong to the project number in VITE_FIREBASE_MESSAGING_SENDER_ID.');
  }
  const bucket = (env.VITE_FIREBASE_STORAGE_BUCKET || '').toLowerCase();
  if (bucket && !bucket.startsWith(`${projectId.toLowerCase()}.`)) {
    problems.push(`VITE_FIREBASE_STORAGE_BUCKET "${bucket}" is not a bucket of project "${projectId}".`);
  }
  if (env.VITE_USE_FIREBASE_EMULATORS === 'true') problems.push('VITE_USE_FIREBASE_EMULATORS is true in the production environment.');
  return problems;
}

/** Returns a list of human readable problems; empty list = safe. */
export function checkFirebaseTargets({ projectFromCli, hook = false, emulator = false } = {}) {
  const iso = loadIsolationConfig();
  const blocked = iso.blocked;
  const problems = [];
  const lower = (v) => String(v || '').trim().toLowerCase();
  const isBlockedProject = (id) => blocked.projectIds.map(lower).includes(lower(id));
  const containsBlocked = (value) =>
    !!value && blocked.projectIds.some((id) => lower(value).includes(lower(id)));

  // 1) .firebaserc
  const rcPath = join(ROOT, '.firebaserc');
  let rcDefault = '';
  if (existsSync(rcPath)) {
    const rc = readJson(rcPath);
    rcDefault = String(rc?.projects?.default || '');
    for (const [alias, id] of Object.entries(rc?.projects || {})) {
      if (isBlockedProject(id)) problems.push(`.firebaserc alias "${alias}" points at the OLD project "${id}".`);
    }
    for (const [projectId, targets] of Object.entries(rc?.targets || {})) {
      if (isBlockedProject(projectId)) problems.push(`.firebaserc has deploy targets for the OLD project "${projectId}".`);
      for (const kinds of Object.values(targets || {})) {
        for (const sites of Object.values(kinds || {})) {
          for (const site of sites || []) {
            if (blocked.hostingSites.map(lower).includes(lower(site))) {
              problems.push(`.firebaserc hosting target uses the OLD site "${site}".`);
            }
          }
        }
      }
    }
  } else if (!emulator) {
    problems.push('.firebaserc is missing. Run `firebase use --add <new-project-id>`.');
  }

  // 2) Frontend environment files (what Vite will bundle)
  const env = {
    ...parseDotEnv(join(ROOT, '.env')),
    ...parseDotEnv(join(ROOT, '.env.local')),
    ...parseDotEnv(join(ROOT, '.env.production')),
    ...parseDotEnv(join(ROOT, '.env.production.local')),
  };
  const envProject = env.VITE_FIREBASE_PROJECT_ID || '';
  const expected = env.VITE_EXPECTED_FIREBASE_PROJECT_ID || '';
  if (isBlockedProject(envProject)) problems.push(`VITE_FIREBASE_PROJECT_ID is the OLD project "${envProject}".`);
  if (containsBlocked(env.VITE_FIREBASE_AUTH_DOMAIN)) problems.push('VITE_FIREBASE_AUTH_DOMAIN belongs to the OLD project.');
  if (containsBlocked(env.VITE_FIREBASE_STORAGE_BUCKET)) problems.push('VITE_FIREBASE_STORAGE_BUCKET belongs to the OLD project.');
  if (blocked.projectNumbers.includes(String(env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''))) {
    problems.push('VITE_FIREBASE_MESSAGING_SENDER_ID is the OLD project number.');
  }
  if (env.VITE_FIREBASE_API_KEY && blocked.apiKeySha256.includes(sha256(env.VITE_FIREBASE_API_KEY))) {
    problems.push('VITE_FIREBASE_API_KEY is the OLD project API key.');
  }
  if (env.VITE_FIREBASE_APP_ID && blocked.appIdSha256.includes(sha256(env.VITE_FIREBASE_APP_ID))) {
    problems.push('VITE_FIREBASE_APP_ID is the OLD project app id.');
  }
  if (envProject && expected && lower(envProject) !== lower(expected)) {
    problems.push(`VITE_FIREBASE_PROJECT_ID "${envProject}" does not match VITE_EXPECTED_FIREBASE_PROJECT_ID "${expected}".`);
  }

  // Callables are reached in the region the frontend is built with; it must be where they are deployed.
  const fnRegion = functionsRegion();
  const envFiles = emulator ? { '.env.emulator': parseDotEnv(join(ROOT, '.env.emulator')) } : { 'production env': env };
  for (const [name, values] of Object.entries(envFiles)) {
    if (!fnRegion) problems.push('Could not read REGION from functions/src/config.ts.');
    else if (values.VITE_FIREBASE_FUNCTIONS_REGION !== fnRegion) {
      problems.push(`VITE_FIREBASE_FUNCTIONS_REGION in ${name} is "${values.VITE_FIREBASE_FUNCTIONS_REGION || ''}" but Cloud Functions deploy to "${fnRegion}".`);
    }
  }

  // 3) The project the CLI is actually about to touch
  const active = projectFromCli || (hook ? process.env.GCLOUD_PROJECT : '') || rcDefault;
  if (!active) {
    problems.push('Could not determine the target Firebase project.');
  } else {
    if (isBlockedProject(active)) problems.push(`Target project "${active}" is the OLD CATCH POS project. Refusing.`);
    if (iso.placeholderProjectIds.map(lower).includes(lower(active))) {
      problems.push(`Target project "${active}" is a placeholder. Configure the NEW project id first.`);
    }
    const isDemo = lower(active).startsWith(iso.emulatorProjectPrefix);
    if (emulator && !isDemo) problems.push(`Emulator runs must use a "${iso.emulatorProjectPrefix}*" project, got "${active}".`);
    if (!emulator && isDemo) problems.push(`"${active}" is an emulator-only project and cannot be deployed.`);
    if (!emulator) {
      if (expected && lower(active) !== lower(expected)) {
        problems.push(`Target project "${active}" differs from VITE_EXPECTED_FIREBASE_PROJECT_ID "${expected}".`);
      }
      if (envProject && lower(active) !== lower(envProject)) {
        problems.push(`Target project "${active}" differs from the frontend VITE_FIREBASE_PROJECT_ID "${envProject}".`);
      }
      if (!expected) problems.push('VITE_EXPECTED_FIREBASE_PROJECT_ID is not set in .env.production / .env.local.');
      problems.push(...webConfigProblems(env, active));
    }
  }
  return { problems, active };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const { problems, active } = checkFirebaseTargets({
    projectFromCli: projectArg,
    hook: flag('hook'),
    emulator: flag('emulator'),
  });
  if (problems.length) {
    console.error('\n\u26D4  FIREBASE ISOLATION GUARD: BLOCKED');
    for (const p of problems) console.error('   - ' + p);
    console.error('\nNothing was deployed or written. Fix the configuration and try again.\n');
    process.exit(1);
  }
  if (!flag('quiet')) console.log(`\u2705 Firebase isolation guard passed. Target project: ${active}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
