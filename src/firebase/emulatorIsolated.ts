/**
 * Fail-closed validation for the isolated emulator harness (Vite mode `emulator-isolated`).
 * Pure configuration checks — no Firebase SDK, no network.
 */
import defaults from '../../config/emulator-isolated.json' with { type: 'json' };
import type { IsolationProblem } from './isolation';

export const ISOLATED_DEMO_PROJECT_ID = defaults.projectId as 'demo-zelvero';

export type EmulatorServiceName = 'auth' | 'firestore' | 'functions' | 'storage';

export interface IsolatedEmulatorEndpoints {
  host: string;
  authOrigin: string;
  firestoreHost: string;
  firestorePort: number;
  functionsHost: string;
  functionsPort: number;
  storageHost: string;
  storagePort: number;
  ports: Record<EmulatorServiceName, number>;
}

export type FirebaseEnvLike = Record<string, string | undefined>;

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const truthy = (v: unknown) => ['true', '1', 'yes'].includes(lower(v));

const CLOUD_PROJECT_IDS: readonly string[] = defaults.blockedCloudProjectIds;
const PRIMARY_PORTS: ReadonlySet<number> = new Set(Object.values(defaults.blockedPrimaryPorts));

const PORT_ENV_KEYS: Record<EmulatorServiceName, string> = {
  auth: 'VITE_FIREBASE_AUTH_EMULATOR_PORT',
  firestore: 'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT',
  functions: 'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT',
  storage: 'VITE_FIREBASE_STORAGE_EMULATOR_PORT',
};

const DEFAULT_PORTS: Record<EmulatorServiceName, number> = {
  auth: defaults.ports.auth,
  firestore: defaults.ports.firestore,
  functions: defaults.ports.functions,
  storage: defaults.ports.storage,
};

export function isEmulatorIsolatedEnabled(env: FirebaseEnvLike): boolean {
  return truthy(env.VITE_EMULATOR_ISOLATED);
}

const EXTRA_DEMO_PROJECT = /^demo-[a-z0-9-]{2,40}$/;

/** The default harness is demo-zelvero. Another demo-* id is allowed only when the env names that exact id. */
export function isolatedProjectAllowed(projectId: string, allow: string | undefined): boolean {
  if (projectId === ISOLATED_DEMO_PROJECT_ID) return true;
  const named = String(allow ?? '').trim();
  if (!named || named !== projectId) return false;
  if (!EXTRA_DEMO_PROJECT.test(projectId)) return false;
  return !CLOUD_PROJECT_IDS.some((id) => lower(id) === lower(projectId));
}

function fatal(message: string): IsolationProblem {
  return { message, fatal: true };
}

function mentionsCloudProject(value: string | undefined): string | null {
  if (!value) return null;
  const hay = lower(value);
  for (const id of CLOUD_PROJECT_IDS) {
    if (hay.includes(lower(id))) return id;
  }
  return null;
}

function parsePort(raw: string | undefined, label: string, fallback: number): { port?: number; error?: string } {
  const value = raw == null || String(raw).trim() === '' ? String(fallback) : String(raw).trim();
  if (!/^\d+$/.test(value)) return { error: `${label} must be an integer port, got "${raw}".` };
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: `${label} must be between 1 and 65535, got ${port}.` };
  }
  if (PRIMARY_PORTS.has(port)) {
    return {
      error: `${label} port ${port} collides with the primary Emulator Suite; isolated harness must use alternate ports.`,
    };
  }
  return { port };
}

function assertLoopbackHost(raw: string | undefined): { host?: string; error?: string } {
  const host = String(raw ?? defaults.host).trim().toLowerCase() || defaults.host;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    return { error: `VITE_FIREBASE_EMULATOR_HOST must be loopback, got "${raw}".` };
  }
  return { host: host === '::1' ? '127.0.0.1' : host === 'localhost' ? '127.0.0.1' : host };
}

/**
 * Validates isolated-harness env. When isolated mode is off, returns [].
 * When on, every problem is fatal — no cloud / staging / production fallback.
 */
export function validateEmulatorIsolatedEnv(env: FirebaseEnvLike): IsolationProblem[] {
  if (!isEmulatorIsolatedEnabled(env)) return [];

  const problems: IsolationProblem[] = [];

  if (!truthy(env.VITE_USE_FIREBASE_EMULATORS)) {
    problems.push(fatal('Isolated emulator mode requires VITE_USE_FIREBASE_EMULATORS=true.'));
  }

  const projectId = String(env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  const expected = String(env.VITE_EXPECTED_FIREBASE_PROJECT_ID ?? '').trim();

  if (!isolatedProjectAllowed(projectId, env.VITE_EMULATOR_ALLOW_DEMO_PROJECT)) {
    problems.push(
      fatal(
        `Isolated emulator mode requires VITE_FIREBASE_PROJECT_ID="${ISOLATED_DEMO_PROJECT_ID}" (got "${projectId || '(empty)'}").`,
      ),
    );
  }
  if (expected && !isolatedProjectAllowed(expected, env.VITE_EMULATOR_ALLOW_DEMO_PROJECT)) {
    problems.push(
      fatal(
        `Isolated emulator mode requires VITE_EXPECTED_FIREBASE_PROJECT_ID="${ISOLATED_DEMO_PROJECT_ID}" (got "${expected}").`,
      ),
    );
  }

  for (const id of CLOUD_PROJECT_IDS) {
    if (lower(projectId) === lower(id) || lower(expected) === lower(id)) {
      problems.push(fatal(`Refusing cloud Firebase project "${id}" in isolated emulator mode.`));
    }
  }

  const scanKeys = [
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_EXPECTED_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
  ] as const;
  for (const key of scanKeys) {
    const hit = mentionsCloudProject(env[key]);
    if (hit) problems.push(fatal(`${key} contains cloud project "${hit}"; isolated harness rejects cloud Firebase configuration.`));
  }

  const hostResult = assertLoopbackHost(env.VITE_FIREBASE_EMULATOR_HOST);
  if (hostResult.error) problems.push(fatal(hostResult.error));

  for (const service of Object.keys(PORT_ENV_KEYS) as EmulatorServiceName[]) {
    const key = PORT_ENV_KEYS[service];
    const parsed = parsePort(env[key], key, DEFAULT_PORTS[service]);
    if (parsed.error) problems.push(fatal(parsed.error));
  }

  return problems;
}

/** Resolve loopback endpoints after validation succeeds. Throws if isolated validation fails. */
export function resolveIsolatedEmulatorEndpoints(env: FirebaseEnvLike): IsolatedEmulatorEndpoints {
  const problems = validateEmulatorIsolatedEnv(env);
  if (problems.length) {
    throw new Error(problems.map((p) => p.message).join('\n'));
  }
  if (!isEmulatorIsolatedEnabled(env)) {
    throw new Error('resolveIsolatedEmulatorEndpoints requires VITE_EMULATOR_ISOLATED=true.');
  }

  const hostResult = assertLoopbackHost(env.VITE_FIREBASE_EMULATOR_HOST);
  const host = hostResult.host!;
  const ports = {} as Record<EmulatorServiceName, number>;
  for (const service of Object.keys(PORT_ENV_KEYS) as EmulatorServiceName[]) {
    ports[service] = parsePort(env[PORT_ENV_KEYS[service]], PORT_ENV_KEYS[service], DEFAULT_PORTS[service]).port!;
  }

  return {
    host,
    authOrigin: `http://${host}:${ports.auth}`,
    firestoreHost: host,
    firestorePort: ports.firestore,
    functionsHost: host,
    functionsPort: ports.functions,
    storageHost: host,
    storagePort: ports.storage,
    ports,
  };
}

/** Defaults exported for docs/tests (Auth 19099, Firestore 18080, …). */
export const ISOLATED_EMULATOR_DEFAULT_PORTS = { ...DEFAULT_PORTS } as const;
