#!/usr/bin/env node
/**
 * Local staging builds for the POS and the marketing site.
 *
 * Reads only the gitignored staging env file for that app. It does not load
 * .env.production and it does not copy production credentials. Vite is started
 * only after the configured staging project id and that file agree, and only
 * with those values exported into the child process so a root .env cannot fill
 * the gaps. The generated bundle is then rejected if it still points at production.
 *
 * This command does not deploy and does not create a Firebase project.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIsolationConfig } from './firebase-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_FILE = /\.(js|mjs|cjs|html|css|json|txt|svg|webmanifest|map)$/i;
const FORCED_VITE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_EXPECTED_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_FUNCTIONS_REGION',
  'VITE_FIREBASE_APPCHECK_SITE_KEY',
  'VITE_FIREBASE_APPCHECK_DEBUG',
  'VITE_USE_FIREBASE_EMULATORS',
  'VITE_POS_ORIGIN',
  'VITE_SALES_BACKEND',
];

export function parseDotEnv(file) {
  if (!file || !existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

function same(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function functionsRegion() {
  const file = join(ROOT, 'functions', 'src', 'config.ts');
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').match(/export const REGION = '([a-z0-9-]+)'/)?.[1] ?? '';
}

function projectIsBlocked(id, iso) {
  const value = String(id || '').trim().toLowerCase();
  if (!value) return false;
  return (iso.blocked?.projectIds || []).some((blocked) => {
    const needle = String(blocked).trim().toLowerCase();
    return value === needle || value.includes(needle);
  });
}

function projectIsPlaceholder(id, iso) {
  const value = String(id || '').trim().toLowerCase();
  return (iso.placeholderProjectIds || []).some((item) => String(item).trim().toLowerCase() === value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches a production project id as its own token.
 * zelvoropos-stage is a different project and must not match zelvoropos.
 */
export function referencesProductionProject(value, productionId) {
  const text = String(value || '');
  if (!text) return false;
  const ids = [...new Set([String(productionId || '').trim(), 'zelvoropos'].filter(Boolean))];
  return ids.some((id) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(id)}(?![A-Za-z0-9-])`, 'i').test(text));
}

function referencesProductionHost(value, iso) {
  const text = String(value || '').toLowerCase();
  const sites = iso.productionHostingSites || ['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging'];
  return sites.some((site) => {
    const name = String(site || '').trim().toLowerCase();
    return Boolean(name) && (text.includes(`${name}.web.app`) || text.includes(`${name}.firebaseapp.com`));
  });
}

/**
 * Validates one staging env object. `productionEnv` is used only to reject copied values.
 * An empty stagingProjectId always fails. zelvoropos is never accepted as a fallback.
 */
export function stagingWebEnvProblems({ kind, env = {}, iso, fnRegion = '', productionEnv = {} }) {
  const problems = [];
  const productionId = String(iso.productionProjectId || 'zelvoropos').trim();
  const stagingId = String(iso.stagingProjectId || '').trim();
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const prefix = String(iso.emulatorProjectPrefix || 'demo-').toLowerCase();

  if (!stagingId) {
    problems.push(
      'Staging project is not configured. Set stagingProjectId only after the staging Firebase project exists. This build cannot fall back to zelvoropos.',
    );
  } else if (projectIsPlaceholder(stagingId, iso)) {
    problems.push(`Staging project id "${stagingId}" is a placeholder.`);
  } else if (projectIsBlocked(stagingId, iso)) {
    problems.push(`Staging project id "${stagingId}" is blocked.`);
  } else if (same(stagingId, productionId) || same(stagingId, 'zelvoropos')) {
    problems.push('Staging project id must be a different project from production (zelvoropos).');
  } else if (stagingId.toLowerCase().startsWith(prefix)) {
    problems.push(`Staging project id "${stagingId}" is an emulator project and cannot be used for a staging build.`);
  }

  if (!projectId) {
    problems.push('Staging VITE_FIREBASE_PROJECT_ID is missing. Refusing to fall back to zelvoropos.');
  } else if (same(projectId, productionId) || same(projectId, 'zelvoropos')) {
    problems.push('Staging VITE_FIREBASE_PROJECT_ID is the production project zelvoropos.');
  } else if (projectIsPlaceholder(projectId, iso)) {
    problems.push(`Staging VITE_FIREBASE_PROJECT_ID "${projectId}" is a placeholder.`);
  } else if (projectIsBlocked(projectId, iso)) {
    problems.push(`Staging VITE_FIREBASE_PROJECT_ID "${projectId}" is blocked.`);
  } else if (projectId.toLowerCase().startsWith(prefix)) {
    problems.push(`Staging VITE_FIREBASE_PROJECT_ID "${projectId}" is an emulator project.`);
  } else if (stagingId && !same(projectId, stagingId)) {
    problems.push(`Staging VITE_FIREBASE_PROJECT_ID must equal the configured staging project "${stagingId}".`);
  }

  const region = String(env.VITE_FIREBASE_FUNCTIONS_REGION || '').trim();
  if (!fnRegion) problems.push('Could not read REGION from functions/src/config.ts.');
  else if (region !== fnRegion) {
    problems.push(`Staging VITE_FIREBASE_FUNCTIONS_REGION is "${region}" but Cloud Functions use "${fnRegion}".`);
  }
  if (String(env.VITE_USE_FIREBASE_EMULATORS || '').toLowerCase() === 'true') {
    problems.push('Staging builds cannot use the Firebase emulators.');
  }

  if (kind === 'pos') {
    const required = [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_STORAGE_BUCKET',
      'VITE_FIREBASE_MESSAGING_SENDER_ID',
      'VITE_FIREBASE_APP_ID',
      'VITE_EXPECTED_FIREBASE_PROJECT_ID',
    ];
    const missing = required.filter((key) => !String(env[key] || '').trim());
    if (missing.length) problems.push(`Staging POS web config is incomplete: ${missing.join(', ')}.`);
    const expected = String(env.VITE_EXPECTED_FIREBASE_PROJECT_ID || '').trim();
    if (projectId && expected && !same(projectId, expected)) {
      problems.push('Staging VITE_EXPECTED_FIREBASE_PROJECT_ID must equal VITE_FIREBASE_PROJECT_ID.');
    }
    const bucket = String(env.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
    if (bucket && projectId && !bucket.toLowerCase().startsWith(`${projectId.toLowerCase()}.`)) {
      problems.push('Staging VITE_FIREBASE_STORAGE_BUCKET must be a bucket of the staging project.');
    }
    const sender = String(env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
    if (sender && !/^\d{6,}$/.test(sender)) problems.push('Staging VITE_FIREBASE_MESSAGING_SENDER_ID must be the numeric project number.');
    const appId = String(env.VITE_FIREBASE_APP_ID || '').trim();
    if (appId && sender && !appId.startsWith(`1:${sender}:web:`)) {
      problems.push('Staging VITE_FIREBASE_APP_ID does not belong to the staging project number.');
    }
  }

  if (kind === 'marketing') {
    const backend = String(env.VITE_SALES_BACKEND || '').trim();
    if (backend !== 'staging') {
      problems.push('Staging marketing VITE_SALES_BACKEND must be "staging". A staging build cannot select the production sales backend.');
    }
    const origin = String(env.VITE_POS_ORIGIN || '').trim();
    if (!origin) problems.push('Staging VITE_POS_ORIGIN is missing. Refusing to link the marketing site at the production POS.');
    else {
      try {
        const url = new URL(origin);
        if (url.protocol !== 'https:') problems.push('Staging VITE_POS_ORIGIN must be an https URL.');
      } catch {
        problems.push('Staging VITE_POS_ORIGIN must be an https URL.');
      }
    }
  }

  const copiedKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_EXPECTED_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APPCHECK_SITE_KEY',
    'VITE_POS_ORIGIN',
  ];
  for (const key of copiedKeys) {
    const value = String(env[key] || '').trim();
    if (!value) continue;
    if (referencesProductionProject(value, productionId) || referencesProductionHost(value, iso)) {
      problems.push(`Staging ${key} references the production project.`);
    }
    const productionValue = String(productionEnv[key] || '').trim();
    if (productionValue && value === productionValue) {
      problems.push(`Staging ${key} matches the production web config. Production values must not be copied into staging.`);
    }
  }
  return problems;
}

export function productionBundleMarkers({
  productionProjectId = 'zelvoropos',
  functionsRegion = 'europe-west1',
  productionEnv = {},
  productionHostingSites = [],
} = {}) {
  const id = String(productionProjectId || 'zelvoropos').trim();
  const region = String(functionsRegion || 'europe-west1').trim();
  const markers = [
    { label: 'production Firebase project', needle: id, match: 'project' },
    { label: 'production Functions hostname', needle: `${region}-${id}.cloudfunctions.net` },
    { label: 'production Storage bucket', needle: `${id}.appspot.com` },
    { label: 'production Storage bucket', needle: `${id}.firebasestorage.app` },
  ];
  for (const site of productionHostingSites) {
    const name = String(site || '').trim();
    if (!name) continue;
    markers.push({ label: 'production Hosting site', needle: `${name}.web.app` });
    markers.push({ label: 'production Hosting site', needle: `${name}.firebaseapp.com` });
  }
  const bucket = String(productionEnv.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
  if (bucket && !markers.some((marker) => marker.needle === bucket)) {
    markers.push({ label: 'production Storage bucket', needle: bucket });
  }
  for (const key of [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_APPCHECK_SITE_KEY',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_AUTH_DOMAIN',
  ]) {
    const value = String(productionEnv[key] || '').trim();
    if (value.length >= 8) markers.push({ label: `production ${key}`, needle: value });
  }
  return markers;
}

export function stagingBundleProblems(dir, markers) {
  if (!dir || !existsSync(dir)) return ['Staging bundle directory is missing.'];
  const problems = [];
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && TEXT_FILE.test(entry.name)) files.push(path);
    }
  };
  walk(dir);
  if (!files.length) return ['Staging bundle has no files to audit.'];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const marker of markers) {
      if (!marker.needle) continue;
      const found = marker.match === 'project'
        ? new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(marker.needle)}(?![A-Za-z0-9-])`, 'i').test(text)
        : text.includes(marker.needle);
      if (found) problems.push(`Staging bundle ${file.slice(dir.length + 1)} contains the ${marker.label}.`);
    }
  }
  return problems;
}

export function stagingEnvPath(kind) {
  return kind === 'marketing' ? join(ROOT, 'apps', 'marketing', '.env.staging') : join(ROOT, '.env.staging');
}

export function loadStagingBuildInputs(kind) {
  const iso = loadIsolationConfig();
  const env = parseDotEnv(stagingEnvPath(kind));
  const productionEnv = {
    ...parseDotEnv(join(ROOT, '.env.production')),
    ...parseDotEnv(join(ROOT, '.env.production.local')),
  };
  return { iso, env, productionEnv, fnRegion: functionsRegion() };
}

export function assertStagingViteMode() {
  if (process.env.ZELVERO_STAGING_BUILD !== '1') {
    throw new Error(
      'Refusing vite --mode staging. Use npm run build:staging or npm run web:build:staging so the build cannot fall back to zelvoropos.',
    );
  }
  const kind = process.env.ZELVERO_STAGING_KIND === 'marketing' ? 'marketing' : 'pos';
  const { iso, env, productionEnv, fnRegion } = loadStagingBuildInputs(kind);
  const problems = stagingWebEnvProblems({ kind, env, iso, fnRegion, productionEnv });
  const fromProcess = String(process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const fromFile = String(env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (fromProcess !== fromFile) {
    problems.push('Vite is not using the staging env file for VITE_FIREBASE_PROJECT_ID. Refusing a fallback project.');
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

function childEnv(env) {
  const child = { ...process.env, ZELVERO_STAGING_BUILD: '1' };
  for (const key of FORCED_VITE_KEYS) delete child[key];
  for (const key of FORCED_VITE_KEYS) child[key] = String(env[key] || '');
  return child;
}

function outputDir(kind) {
  return kind === 'marketing' ? join(ROOT, 'apps', 'marketing', 'staging-dist') : join(ROOT, 'staging-dist');
}

function runChecked(command, cwd, env) {
  execSync(command, { cwd, env, stdio: 'inherit' });
}

export function buildStaging(kind) {
  if (kind !== 'pos' && kind !== 'marketing') {
    console.error(`Unknown staging app "${kind}". Use pos or marketing.`);
    return 1;
  }
  const { iso, env, productionEnv, fnRegion } = loadStagingBuildInputs(kind);
  const problems = stagingWebEnvProblems({ kind, env, iso, fnRegion, productionEnv });
  if (problems.length) {
    console.error('\nStaging build blocked:');
    problems.forEach((problem) => console.error('   - ' + problem));
    console.error('No staging bundle was written. No Firebase command was run.');
    return 1;
  }
  const out = outputDir(kind);
  const cwd = kind === 'marketing' ? join(ROOT, 'apps', 'marketing') : ROOT;
  const envForVite = childEnv(env);
  envForVite.ZELVERO_STAGING_KIND = kind;
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  runChecked('npx tsc -b --pretty false', cwd, envForVite);
  runChecked('npx vite build --mode staging --outDir staging-dist', cwd, envForVite);
  if (!existsSync(out) || !statSync(out).isDirectory()) {
    console.error('Staging build did not create an output directory.');
    return 1;
  }
  const bundleProblems = stagingBundleProblems(
    out,
    productionBundleMarkers({
      productionProjectId: iso.productionProjectId,
      functionsRegion: fnRegion,
      productionEnv,
      productionHostingSites: iso.productionHostingSites,
    }),
  );
  if (bundleProblems.length) {
    rmSync(out, { recursive: true, force: true });
    console.error('\nStaging bundle rejected:');
    bundleProblems.forEach((problem) => console.error('   - ' + problem));
    console.error('The output directory was removed. No Firebase command was run.');
    return 1;
  }
  console.log(`\nStaging ${kind} bundle is local only: ${out}`);
  console.log('It was not deployed.');
  return 0;
}

function main() {
  const kind = process.argv[2];
  process.exit(buildStaging(kind));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
