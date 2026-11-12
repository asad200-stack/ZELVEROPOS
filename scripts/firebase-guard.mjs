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
 *   --hook        running inside a Firebase CLI predeploy hook (uses $GCLOUD_PROJECT).
 *                 Hooks require the production project. They do not read the marketing env,
 *                 so a missing website env cannot block a POS deploy.
 *   --project=ID  explicit project being targeted
 *   --emulator    only a "demo-" emulator project is acceptable
 *   --quiet       print only failures
 *
 * `npm run firebase:verify` also checks apps/marketing/.env.production as its own object.
 * Staging roles refuse to deploy until config/firebase-isolation.json stagingProjectId is a
 * real project id other than production and other than a demo-* emulator project.
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

const MARKETING_ENV_FILE = join('apps', 'marketing', '.env.production');

function sameId(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function projectIsBlocked(id, iso) {
  const value = String(id || '').trim().toLowerCase();
  if (!value) return false;
  return iso.blocked.projectIds.some((blocked) => {
    const needle = String(blocked).trim().toLowerCase();
    return value === needle || value.includes(needle);
  });
}

function projectIsPlaceholder(id, iso) {
  const value = String(id || '').trim().toLowerCase();
  return iso.placeholderProjectIds.some((item) => String(item).trim().toLowerCase() === value);
}

/**
 * Marketing website env only. Never merged into the POS env, and never asked for POS web-app keys.
 * `exists: false` fails closed for verify and for the marketing deploy.
 */
export function marketingConfigProblems({ exists, env = {}, fnRegion = '', iso }) {
  if (!exists) return ['Marketing environment file apps/marketing/.env.production is missing.'];
  const problems = [];
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) problems.push('Marketing VITE_FIREBASE_PROJECT_ID is missing.');
  else if (projectIsBlocked(projectId, iso)) problems.push(`Marketing VITE_FIREBASE_PROJECT_ID "${projectId}" is a blocked project.`);
  else if (projectIsPlaceholder(projectId, iso)) problems.push(`Marketing VITE_FIREBASE_PROJECT_ID "${projectId}" is a placeholder.`);
  if (!fnRegion) problems.push('Could not read REGION from functions/src/config.ts.');
  else if (String(env.VITE_FIREBASE_FUNCTIONS_REGION || '').trim() !== fnRegion) {
    problems.push(
      `Marketing VITE_FIREBASE_FUNCTIONS_REGION is "${env.VITE_FIREBASE_FUNCTIONS_REGION || ''}" but Cloud Functions deploy to "${fnRegion}".`,
    );
  }
  return problems;
}

/**
 * Production deploys must target productionProjectId.
 * Staging deploys stay disabled until stagingProjectId is a different, non-emulator project.
 */
export function deploymentRoleProblems({ role, active = '', iso }) {
  const productionId = String(iso.productionProjectId || '').trim();
  const stagingId = String(iso.stagingProjectId || '').trim();
  if (role === 'production') {
    const problems = [];
    if (!productionId || projectIsPlaceholder(productionId, iso)) problems.push('Production project id is not configured.');
    else if (projectIsBlocked(productionId, iso)) problems.push(`Production project id "${productionId}" is blocked.`);
    if (!sameId(active, productionId)) {
      problems.push(`Production deployments must target "${productionId || 'the configured production project'}", got "${active || ''}".`);
    }
    return problems;
  }
  if (role === 'staging') {
    const problems = [];
    if (!stagingId) problems.push('Staging project is not configured. Staging deployment is disabled.');
    else if (projectIsPlaceholder(stagingId, iso)) problems.push(`Staging project id "${stagingId}" is a placeholder.`);
    else if (projectIsBlocked(stagingId, iso)) problems.push(`Staging project id "${stagingId}" is blocked.`);
    else if (sameId(stagingId, productionId) || sameId(stagingId, 'zelvoropos')) {
      problems.push('Staging project id must be a different project from production (zelvoropos).');
    } else if (String(stagingId).toLowerCase().startsWith(String(iso.emulatorProjectPrefix || 'demo-').toLowerCase())) {
      problems.push(`Staging project id "${stagingId}" is an emulator project and cannot be deployed.`);
    } else if (!sameId(active, stagingId)) {
      problems.push(`Staging deployments must target "${stagingId}", got "${active || ''}".`);
    }
    if (productionId && sameId(active, productionId)) {
      problems.push(`Refusing to deploy staging to the production project "${productionId}".`);
    }
    return problems;
  }
  return [`Unknown deployment role "${role}".`];
}

/** Production uses the .firebaserc default. A configured staging id replaces that default. */
export function resolveActiveProject({ projectFromCli = '', hookProject = '', role = '', stagingProjectId = '', rcDefault = '' } = {}) {
  let active = projectFromCli || hookProject || '';
  if (!active && role === 'staging') active = String(stagingProjectId || '').trim();
  if (!active) active = rcDefault;
  return active;
}

/** npm deploy targets. Only the hosting:staging entry is a staging deploy; named functions stay production. */
export function roleForDeployTarget(target) {
  return target === 'staging' ? 'staging' : 'production';
}

const DEFAULT_PRODUCTION_HOSTING_SITES = ['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging'];

/**
 * Staging deploys may target only the hosting sites configured for the staging project.
 * Sites that already exist on the production project are refused, including while those ids are empty.
 */
export function stagingHostingProblems({ iso, rc = {} }) {
  const problems = [];
  const configured = iso.stagingHostingSites || {};
  const pos = String(configured.pos || '').trim();
  const marketing = String(configured.marketing || '').trim();
  const forbidden = new Set(
    [...(iso.productionHostingSites || DEFAULT_PRODUCTION_HOSTING_SITES), ...(iso.blocked?.hostingSites || [])]
      .map((site) => String(site).trim().toLowerCase())
      .filter(Boolean),
  );
  const rejectSite = (label, site) => {
    if (!site) {
      problems.push(`Staging ${label} hosting site is not configured.`);
      return;
    }
    if (forbidden.has(site.toLowerCase())) {
      problems.push(`Staging ${label} hosting site "${site}" belongs to the production project and cannot be a staging target.`);
    }
  };
  rejectSite('POS', pos);
  rejectSite('marketing', marketing);
  const stagingId = String(iso.stagingProjectId || '').trim();
  if (!stagingId) {
    problems.push('Staging hosting targets cannot be selected until stagingProjectId is set.');
    return problems;
  }
  const hosting = rc?.targets?.[stagingId]?.hosting;
  if (!hosting) {
    problems.push(`.firebaserc has no hosting targets for staging project "${stagingId}".`);
    return problems;
  }
  const expected = [
    ['staging', pos, hosting.staging],
    ['web-staging', marketing, hosting['web-staging']],
  ];
  for (const [target, site, list] of expected) {
    const sites = Array.isArray(list) ? list : [];
    if (site && (sites.length !== 1 || sites[0] !== site)) {
      problems.push(`Staging deploy target "${target}" on project "${stagingId}" must be exactly ["${site}"].`);
    }
  }
  for (const list of Object.values(hosting)) {
    for (const site of list || []) {
      if (forbidden.has(String(site).trim().toLowerCase())) {
        problems.push(`Staging project "${stagingId}" lists production hosting site "${site}".`);
      }
    }
  }
  return problems;
}

const PRODUCTION_MARKETING_DIR = 'apps/marketing/dist';
const STAGING_MARKETING_DIR = 'apps/marketing/staging-dist';
const productionProjectToken = /(?<![A-Za-z0-9])zelvoropos(?![A-Za-z0-9-])/;

function hostingByTarget(firebase = {}) {
  const entries = Array.isArray(firebase.hosting) ? firebase.hosting : [];
  return Object.fromEntries(entries.filter((item) => item && item.target).map((item) => [item.target, item]));
}

function oneSite(list, site) {
  return Array.isArray(list) && list.length === 1 && list[0] === site;
}

/**
 * Production marketing publishes apps/marketing/dist to zelvero-web-staging.
 * Isolated staging marketing publishes apps/marketing/staging-dist to the staging site.
 * The same target name must not be able to publish the other bundle.
 */
export function marketingHostingProblems({ firebase = {}, rc = {}, iso = {} } = {}) {
  const problems = [];
  const byTarget = hostingByTarget(firebase);
  if (byTarget.production?.public !== 'dist') problems.push('POS production hosting public directory must stay "dist".');
  if (byTarget.staging?.public !== 'release-dist') problems.push('POS staging hosting public directory must stay "release-dist".');
  if (byTarget.marketing?.public !== PRODUCTION_MARKETING_DIR) {
    problems.push(`Production marketing target "marketing" must publish ${PRODUCTION_MARKETING_DIR}.`);
  }
  if (byTarget['web-staging']?.public !== STAGING_MARKETING_DIR) {
    problems.push(`Staging marketing target "web-staging" must publish ${STAGING_MARKETING_DIR}.`);
  }

  const productionId = String(iso.productionProjectId || '').trim();
  const stagingId = String(iso.stagingProjectId || '').trim();
  const productionHosting = rc.targets?.[productionId]?.hosting || {};
  const stagingHosting = rc.targets?.[stagingId]?.hosting || {};
  const customerSite = 'zelvero-web-staging';
  const stagingSite = String(iso.stagingHostingSites?.marketing || '').trim();

  if (!oneSite(productionHosting.marketing, customerSite)) {
    problems.push(`Production project hosting target "marketing" must be exactly ["${customerSite}"].`);
  }
  if (productionHosting['web-staging']) {
    problems.push('Production project must not have a "web-staging" hosting target. That target publishes the isolated staging bundle.');
  }
  if (stagingHosting.marketing) {
    problems.push('Staging project must not have a "marketing" hosting target. That target publishes the production marketing bundle.');
  }
  if (stagingId && stagingSite && !oneSite(stagingHosting['web-staging'], stagingSite)) {
    problems.push(`Staging project hosting target "web-staging" must be exactly ["${stagingSite}"].`);
  }
  return problems;
}

/** The project, Hosting target, and output directory must be one of the two exact marketing releases. */
export function marketingDeployProblems({ projectId = '', target = '', publicDir = '', iso = {} } = {}) {
  const productionId = String(iso.productionProjectId || '').trim();
  const stagingId = String(iso.stagingProjectId || '').trim();
  const dir = String(publicDir || '').replace(/\\/g, '/');
  const production = projectId === productionId && target === 'marketing' && dir === PRODUCTION_MARKETING_DIR;
  const staging = Boolean(stagingId) && projectId === stagingId && target === 'web-staging' && dir === STAGING_MARKETING_DIR;
  if (production || staging) return [];
  return [
    `Refusing marketing deploy: project "${projectId}", target "${target}", and directory "${dir}" do not match production (${productionId} / marketing / ${PRODUCTION_MARKETING_DIR}) or staging (${stagingId} / web-staging / ${STAGING_MARKETING_DIR}).`,
  ];
}

/** Confirms a built marketing bundle names only the project for that release. */
export function marketingBundleProblems(role, text = '') {
  const problems = [];
  const namesProduction = productionProjectToken.test(String(text));
  const namesStaging = String(text).includes('zelvoropos-stage');
  if (role === 'production') {
    if (!namesProduction) problems.push('Production marketing bundle does not name project zelvoropos.');
    if (namesStaging) problems.push('Production marketing bundle names the staging project zelvoropos-stage.');
  } else if (role === 'staging') {
    if (!namesStaging) problems.push('Staging marketing bundle does not name project zelvoropos-stage.');
    if (namesProduction) problems.push('Staging marketing bundle names the production project zelvoropos.');
  } else {
    problems.push(`Unknown marketing bundle role "${role}".`);
  }
  return problems;
}

/** Returns a list of human readable problems; empty list = safe. */
export function checkFirebaseTargets({
  projectFromCli,
  hook = false,
  emulator = false,
  role,
  requireMarketingEnv = false,
  marketingEnvFile,
} = {}) {
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

  // 3) The project the CLI is actually about to touch.
  // Staging does not use the .firebaserc default, which stays the production project.
  const active = resolveActiveProject({
    projectFromCli,
    hookProject: hook ? process.env.GCLOUD_PROJECT : '',
    role,
    stagingProjectId: iso.stagingProjectId,
    rcDefault,
  });
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
    if (!emulator && role !== 'staging') {
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

  // Marketing env stays a separate object. A missing file fails verify and the website deploy only.
  if (!emulator && requireMarketingEnv) {
    const marketingPath = marketingEnvFile || join(ROOT, MARKETING_ENV_FILE);
    const marketingExists = existsSync(marketingPath);
    const marketingEnv = marketingExists ? parseDotEnv(marketingPath) : {};
    problems.push(...marketingConfigProblems({ exists: marketingExists, env: marketingEnv, fnRegion: functionsRegion(), iso }));
  }
  if (!emulator && role) problems.push(...deploymentRoleProblems({ role, active, iso }));
  if (!emulator) {
    const firebasePath = join(ROOT, 'firebase.json');
    const firebase = existsSync(firebasePath) ? readJson(firebasePath) : {};
    const rcFile = existsSync(rcPath) ? readJson(rcPath) : {};
    problems.push(...marketingHostingProblems({ firebase, rc: rcFile, iso }));
  }
  if (!emulator && role === 'staging') {
    const rc = existsSync(rcPath) ? readJson(rcPath) : {};
    problems.push(...stagingHostingProblems({ iso, rc }));
  }
  return { problems, active };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const emulator = flag('emulator');
  const iso = loadIsolationConfig();
  const hinted = projectArg || (flag('hook') ? process.env.GCLOUD_PROJECT || '' : '');
  const stagingId = String(iso.stagingProjectId || '').trim();
  const role = emulator ? undefined : stagingId && hinted && sameId(hinted, stagingId) ? 'staging' : 'production';
  const { problems, active } = checkFirebaseTargets({
    projectFromCli: projectArg,
    hook: flag('hook'),
    emulator,
    role,
    requireMarketingEnv: !emulator && !flag('hook'),
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
