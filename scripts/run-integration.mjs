// Starts the standard integration suite with the local Storage emulator.
// Account deletion cleans Storage, so this host must stay on loopback.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ports = JSON.parse(readFileSync(resolve(root, 'tests/integration/emulatorPorts.json'), 'utf8'));

const DEFAULT_STORAGE = `127.0.0.1:${ports.primary.storage}`;
const host = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST || DEFAULT_STORAGE)
  .trim()
  .replace(/^https?:\/\//, '');
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  console.error(`[integration] refusing non-local storage host ${host}`);
  process.exit(1);
}

const isolatedRaw = process.env[ports.isolatedModeEnv]?.trim().toLowerCase();
const isolatedMode = isolatedRaw === '1' || isolatedRaw === 'true' || isolatedRaw === 'yes';
const configPath = process.env.ZELVERO_FIREBASE_CONFIG?.trim();

function parsePort(raw, label) {
  const value = (raw || '').trim();
  if (!value) throw new Error(`Isolated emulator mode requires ${label}`);
  const normalized = value.includes('://') ? value : `http://${value}`;
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${label} is not a valid host:port or URL: ${raw}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`${label} must be loopback, got ${url.hostname}`);
  }
  if (!url.port) throw new Error(`${label} must include an explicit port`);
  return Number(url.port);
}

if (isolatedMode) {
  try {
    if (!configPath) {
      throw new Error(
        `Isolated mode requires ZELVERO_FIREBASE_CONFIG pointing at a temp firebase.json with isolated ports (refusing stock primary ports)`,
      );
    }
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    const emulators = cfg.emulators || {};
    const expected = [
      ['firestore', emulators.firestore?.port, ports.isolated.firestore],
      ['auth', emulators.auth?.port, ports.isolated.auth],
      ['functions', emulators.functions?.port, ports.isolated.functions],
      ['storage', emulators.storage?.port, ports.isolated.storage],
      ['hub', emulators.hub?.port, ports.isolated.hub],
    ];
    const primaryPorts = new Set(Object.values(ports.primary));
    for (const [name, actual, want] of expected) {
      if (actual !== want) {
        throw new Error(`Isolated config ${name} port must be ${want}, got ${actual}`);
      }
      if (primaryPorts.has(actual)) {
        throw new Error(`Isolated config ${name} port ${actual} collides with the primary stack`);
      }
    }
    if (process.env.FUNCTIONS_EMULATOR_HOST?.trim()) {
      const fnPort = parsePort(process.env.FUNCTIONS_EMULATOR_HOST, 'FUNCTIONS_EMULATOR_HOST');
      if (fnPort !== ports.isolated.functions) {
        throw new Error(`FUNCTIONS_EMULATOR_HOST must use isolated port ${ports.isolated.functions}, got ${fnPort}`);
      }
    }
    for (const id of [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT]) {
      if (id && id.trim() && id.trim() !== ports.projectId) {
        throw new Error(`Isolated emulator mode requires project ${ports.projectId}, got ${id}`);
      }
    }
  } catch (error) {
    console.error(`[integration] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.info(`[isolated-emulators] project=${ports.projectId}`);
  console.info(`[isolated-emulators] functions=http://127.0.0.1:${ports.isolated.functions}`);
  console.info(`[isolated-emulators] firestore=127.0.0.1:${ports.isolated.firestore}`);
  console.info(`[isolated-emulators] auth=127.0.0.1:${ports.isolated.auth}`);
  console.info(`[isolated-emulators] hub=127.0.0.1:${ports.isolated.hub}`);
  console.info(`[isolated-emulators] storage=127.0.0.1:${ports.isolated.storage}`);
  console.info(`[isolated-emulators] config=${configPath}`);
}

const functionsHost =
  process.env.FUNCTIONS_EMULATOR_HOST?.trim() ||
  (isolatedMode ? `127.0.0.1:${ports.isolated.functions}` : undefined);

const env = {
  ...process.env,
  CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
  STORAGE_EMULATOR_HOST: isolatedMode ? `127.0.0.1:${ports.isolated.storage}` : host,
  FIREBASE_STORAGE_EMULATOR_HOST: isolatedMode ? `127.0.0.1:${ports.isolated.storage}` : host,
  ...(isolatedMode
    ? {
        [ports.isolatedModeEnv]: '1',
        FUNCTIONS_EMULATOR_HOST: functionsHost,
      }
    : {}),
};

if (configPath) console.info(`[integration] using firebase config ${configPath}`);
if (functionsHost) console.info(`[integration] FUNCTIONS_EMULATOR_HOST=${functionsHost}`);

const configFlag = configPath ? `--config "${configPath}" ` : '';
const command = [
  `npx firebase-tools ${configFlag}emulators:exec`,
  '--only auth,firestore,functions,pubsub,storage',
  `--project ${ports.projectId}`,
  '"vitest run --config vitest.integration.config.ts"',
].join(' ');

const child = spawn(command, { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
