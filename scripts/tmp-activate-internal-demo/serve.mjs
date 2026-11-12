#!/usr/bin/env node
/**
 * TEMPORARY local-only activator for adminProvisionInternalDemo.
 *
 * Safe scope:
 *   - Serves only on 127.0.0.1
 *   - Uses .env.production public Firebase web config
 *   - Invokes only adminProvisionInternalDemo with {}
 *   - Never logs tokens or credentials
 *
 * Run:  node scripts/tmp-activate-internal-demo/serve.mjs
 * Open: http://127.0.0.1:8765/
 *
 * REMOVE AFTER USE:
 *   Delete the folder scripts/tmp-activate-internal-demo/
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const HOST = '127.0.0.1';
const EXPECTED_PROJECT = 'zelvoropos';

function loadProductionEnv() {
  const raw = readFileSync(join(process.cwd(), '.env.production'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i)] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadProductionEnv();
const projectId = env.VITE_FIREBASE_PROJECT_ID;
if (projectId !== EXPECTED_PROJECT) {
  console.error(`Refusing to start: VITE_FIREBASE_PROJECT_ID is not ${EXPECTED_PROJECT}.`);
  process.exit(1);
}
if (String(env.VITE_USE_FIREBASE_EMULATORS).toLowerCase() === 'true') {
  console.error('Refusing to start: emulator mode is enabled in .env.production.');
  process.exit(1);
}

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  functionsRegion: env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1',
};

for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) {
  if (!config[k]) {
    console.error(`Refusing to start: missing Firebase web config field ${k}.`);
    process.exit(1);
  }
}

const page = readFileSync(join(__dir, 'page.html'), 'utf8').replace(
  '/*__FIREBASE_CONFIG__*/',
  `window.__FIREBASE_CONFIG__ = ${JSON.stringify(config)};`,
);

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(page);
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Temporary internal-demo activator on http://${HOST}:${PORT}/`);
  console.log('Sign in as Super Admin, confirm, then invoke once.');
  console.log('After use: delete scripts/tmp-activate-internal-demo/');
});
