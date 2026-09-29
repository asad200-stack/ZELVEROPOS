/**
 * Sync build metadata into public/build-manifest.json and index.html.
 * Run before hosting deploy so each release points at real asset versions.
 *
 * Usage:
 *   node scripts/sync-build-manifest.js [test|prod] [--bump]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX_PATH = path.join(PUBLIC, 'index.html');
const MANIFEST_PATH = path.join(PUBLIC, 'build-manifest.json');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

const env = (process.argv[2] || 'test').toLowerCase();
const shouldBump = process.argv.includes('--bump');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readIndexHtml() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}

function extractVersion(html, pattern) {
  const match = html.match(pattern);
  return match ? Number(match[1] || 0) || 0 : 0;
}

function getGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (_) {
    return 'local';
  }
}

function upsertBuildMetaScript(html, meta) {
  const block = `<script id="app-build-meta">\nwindow.__APP_BUILD_META = ${JSON.stringify(meta)};\nwindow.__APP_VERSION_CODE = Number(window.__APP_BUILD_META.scriptVersion || 0) || 0;\nwindow.__APP_VERSION_LABEL = String(window.__APP_BUILD_META.appVersion || window.__APP_BUILD_META.version || '1.0.0');\n</script>`;
  if (html.includes('id="app-build-meta"')) {
    return html.replace(/<script id="app-build-meta">[\s\S]*?<\/script>/, block);
  }
  return html.replace(
    /<script src="\/app-environment\.js\?v=\d+"><\/script>/,
    `${block}\n    <script src="/app-environment.js?v=1"></script>`
  );
}

function main() {
  let html = readIndexHtml();
  let scriptVersion = extractVersion(html, /script\.js\?v=(\d+)/i);
  let cssVersion = extractVersion(html, /styles\.css\?v=(\d+)/i);
  const previousManifest = readJson(MANIFEST_PATH, {});
  const pkg = (() => {
    try { return readJson(PACKAGE_PATH, { version: '1.0.0' }); } catch (_) { return { version: '1.0.0' }; }
  })();

  if (shouldBump) {
    scriptVersion = Math.max(scriptVersion, Number(previousManifest.scriptVersion || 0)) + 1;
    cssVersion = Math.max(cssVersion, Number(previousManifest.cssVersion || 0)) + 1;
    html = html.replace(/script\.js\?v=\d+/gi, `script.js?v=${scriptVersion}`);
    html = html.replace(/styles\.css\?v=\d+/gi, `styles.css?v=${cssVersion}`);
    html = html.replace(/super-admin\.js\?v=\d+/gi, `super-admin.js?v=${scriptVersion}`);
    html = html.replace(/sw\.js\?v=\d+/gi, `sw.js?v=${scriptVersion}`);
  }

  if (!scriptVersion) scriptVersion = Number(previousManifest.scriptVersion || 61) || 61;
  if (!cssVersion) cssVersion = Number(previousManifest.cssVersion || 83) || 83;

  const appVersion = String(previousManifest.version || previousManifest.appVersion || pkg.version || '1.0.0');
  const environment = env === 'prod' ? 'production' : 'test';
  const manifest = {
    buildId: String(scriptVersion),
    version: appVersion,
    appVersion,
    scriptVersion,
    cssVersion,
    environment,
    env: environment === 'production' ? 'prod' : 'test',
    deployedAt: new Date().toISOString(),
    commit: getGitCommit()
  };

  html = upsertBuildMetaScript(html, manifest);
  fs.writeFileSync(INDEX_PATH, html, 'utf8');
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Build manifest synced (${manifest.environment}): buildId=${manifest.buildId}, script=v${manifest.scriptVersion}`);
}

main();
