#!/usr/bin/env node
/**
 * Builds an immutable versioned app tree into release-dist/ for the staging Hosting site.
 * Does not retarget production stores and does not write a 1.0.0 freeze record.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentRoleProblems, loadIsolationConfig } from './firebase-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const iso = loadIsolationConfig();
const stagingId = String(iso.stagingProjectId || '').trim();
const stagingProblems = deploymentRoleProblems({ role: 'staging', active: stagingId, iso });
if (stagingProblems.length) {
  console.error('Refusing to assemble a staging release:');
  stagingProblems.forEach((problem) => console.error('   - ' + problem));
  console.error('No POS build was started and no Firebase command was run.');
  process.exit(1);
}
const version = process.env.VITE_APP_RELEASE_VERSION || '0.9.0-dev';
const buildId = process.env.VITE_APP_BUILD_ID || `dev-${Date.now()}`;
const gitSha = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
const out = join(ROOT, 'release-dist');
const tree = join(out, 'app', version);
const kept = join(ROOT, 'release-dist-keep');

if (existsSync(out)) {
  rmSync(kept, { recursive: true, force: true });
  cpSync(out, kept, { recursive: true });
}

process.env.VITE_APP_RELEASE_VERSION = version;
process.env.VITE_APP_BUILD_ID = `${buildId}+${gitSha}`;
process.env.ZELVERO_BASE = `/app/${version}/`;

execSync('node scripts/staging-build.mjs pos', { cwd: ROOT, stdio: 'inherit', env: process.env });

rmSync(out, { recursive: true, force: true });
mkdirSync(tree, { recursive: true });
cpSync(join(ROOT, 'staging-dist'), tree, { recursive: true });

if (existsSync(join(kept, 'app'))) {
  for (const name of readdirSync(join(kept, 'app'))) {
    if (name === version) continue;
    cpSync(join(kept, 'app', name), join(out, 'app', name), { recursive: true });
  }
}

writeFileSync(
  join(out, 'release.json'),
  JSON.stringify({ defaultVersion: version, buildId: process.env.VITE_APP_BUILD_ID, gitSha, createdAt: Date.now() }, null, 2),
);
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en" dir="ltr" data-release-boot="1">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZELVERO POS</title>
    <script src="/boot.js"></script>
  </head>
  <body></body>
</html>
`,
);
writeFileSync(join(out, 'boot.js'), readFileSync(join(ROOT, 'public', 'boot.js')));

const trees = existsSync(join(out, 'app')) ? readdirSync(join(out, 'app')) : [version];
const firebasePath = join(ROOT, 'firebase.json');
const firebase = JSON.parse(readFileSync(firebasePath, 'utf8'));
const staging = Array.isArray(firebase.hosting) ? firebase.hosting.find((h) => h.target === 'staging') : null;
if (staging) {
  staging.rewrites = [
    ...trees.map((v) => ({ source: `/app/${v}/**`, destination: `/app/${v}/index.html` })),
    { source: '**', destination: '/index.html' },
  ];
  writeFileSync(firebasePath, JSON.stringify(firebase, null, 2) + '\n');
}

console.info(`[release] assembled ${version} (${process.env.VITE_APP_BUILD_ID}) trees=${trees.join(',')}`);
