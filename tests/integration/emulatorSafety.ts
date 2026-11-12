/**
 * Fail-closed endpoint safety for Integration/Concurrency when an explicit
 * isolated-emulator mode is enabled. Normal local workflow keeps stock defaults.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type EmulatorService = 'firestore' | 'auth' | 'functions' | 'storage' | 'pubsub' | 'ui' | 'hub';

export interface EmulatorPortMap {
  firestore: number;
  auth: number;
  functions: number;
  storage: number;
  pubsub: number;
  ui: number;
  hub: number;
}

export interface EmulatorPortsConfig {
  projectId: string;
  isolatedModeEnv: string;
  primary: EmulatorPortMap;
  isolated: EmulatorPortMap;
}

export interface HostPort {
  host: string;
  port: number;
  hostPort: string;
  origin: string;
}

export interface IsolatedEndpoints {
  projectId: string;
  functions: HostPort;
  firestore: HostPort;
  auth: HostPort;
  hub: HostPort;
  storage?: HostPort;
}

export interface IsolatedSafetyOptions {
  requireStorage?: boolean;
  requireHub?: boolean;
  ports?: EmulatorPortsConfig;
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadEmulatorPortsConfig(path = resolve(here, 'emulatorPorts.json')): EmulatorPortsConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as EmulatorPortsConfig;
}

export const EMULATOR_PORTS = loadEmulatorPortsConfig();

export function isIsolatedEmulatorMode(env: NodeJS.ProcessEnv = process.env, ports: EmulatorPortsConfig = EMULATOR_PORTS): boolean {
  const raw = env[ports.isolatedModeEnv]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function parseLoopbackHostPort(raw: string, label: string): HostPort {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${label} is empty`);

  let url: URL;
  try {
    url = trimmed.includes('://') ? new URL(trimmed) : new URL(`http://${trimmed}`);
  } catch {
    throw new Error(`${label} is not a valid host:port or URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http(s), got ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(`${label} must be loopback, got ${url.hostname}`);
  }
  if (!url.port) throw new Error(`${label} must include an explicit port: ${raw}`);

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} has an invalid port: ${url.port}`);
  }

  const displayHost = host === '::1' ? '[::1]' : host;
  return {
    host: displayHost,
    port,
    hostPort: `${displayHost}:${port}`,
    origin: `http://${displayHost}:${port}`,
  };
}

function primaryPortSet(primary: EmulatorPortMap): Set<number> {
  return new Set(Object.values(primary));
}

function assertIsolatedService(
  raw: string | undefined,
  label: string,
  service: EmulatorService,
  ports: EmulatorPortsConfig,
): HostPort {
  if (!raw?.trim()) {
    throw new Error(`Isolated emulator mode requires ${label} (expected ${ports.isolated[service]}).`);
  }
  const parsed = parseLoopbackHostPort(raw, label);
  const expected = ports.isolated[service];
  if (parsed.port !== expected) {
    throw new Error(`${label} must use isolated ${service} port ${expected}, got ${parsed.port}`);
  }
  if (primaryPortSet(ports.primary).has(parsed.port)) {
    throw new Error(`${label} points at a primary-stack port (${parsed.port}); refusing isolated run`);
  }
  return parsed;
}

function readStorageHost(env: NodeJS.ProcessEnv): string | undefined {
  return env.FIREBASE_STORAGE_EMULATOR_HOST?.trim() || env.STORAGE_EMULATOR_HOST?.trim() || undefined;
}

function assertProjectId(env: NodeJS.ProcessEnv, ports: EmulatorPortsConfig): string {
  const expected = ports.projectId;
  if (expected !== 'demo-zelvero') {
    throw new Error(`emulatorPorts.json projectId must be demo-zelvero, got ${expected}`);
  }
  const candidates = [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, env.GCLOUD_PROJECT_ID]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
  for (const id of candidates) {
    if (id !== expected) {
      throw new Error(`Isolated emulator mode requires project ${expected}, got ${id}`);
    }
  }
  return expected;
}

/**
 * When isolated mode is enabled, require explicit loopback endpoints on the
 * expected isolated ports and refuse any primary-stack port collision.
 * When isolated mode is off, this is a no-op and returns null.
 */
export function assertIsolatedEmulatorSafety(
  env: NodeJS.ProcessEnv = process.env,
  options: IsolatedSafetyOptions = {},
): IsolatedEndpoints | null {
  const ports = options.ports ?? EMULATOR_PORTS;
  if (!isIsolatedEmulatorMode(env, ports)) return null;

  const requireStorage = options.requireStorage ?? false;
  const requireHub = options.requireHub ?? true;
  const projectId = assertProjectId(env, ports);

  const functions = assertIsolatedService(env.FUNCTIONS_EMULATOR_HOST, 'FUNCTIONS_EMULATOR_HOST', 'functions', ports);
  const firestore = assertIsolatedService(env.FIRESTORE_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST', 'firestore', ports);
  const auth = assertIsolatedService(env.FIREBASE_AUTH_EMULATOR_HOST, 'FIREBASE_AUTH_EMULATOR_HOST', 'auth', ports);
  const hub = requireHub
    ? assertIsolatedService(env.FIREBASE_EMULATOR_HUB, 'FIREBASE_EMULATOR_HUB', 'hub', ports)
    : parseLoopbackHostPort(env.FIREBASE_EMULATOR_HUB?.trim() || `127.0.0.1:${ports.isolated.hub}`, 'FIREBASE_EMULATOR_HUB');

  let storage: HostPort | undefined;
  if (requireStorage) {
    storage = assertIsolatedService(readStorageHost(env), 'FIREBASE_STORAGE_EMULATOR_HOST', 'storage', ports);
  }

  return { projectId, functions, firestore, auth, hub, storage };
}

export function printIsolatedEndpoints(endpoints: IsolatedEndpoints): void {
  console.info(`[isolated-emulators] project=${endpoints.projectId}`);
  console.info(`[isolated-emulators] functions=${endpoints.functions.origin}`);
  console.info(`[isolated-emulators] firestore=${endpoints.firestore.hostPort}`);
  console.info(`[isolated-emulators] auth=${endpoints.auth.hostPort}`);
  console.info(`[isolated-emulators] hub=${endpoints.hub.hostPort}`);
  if (endpoints.storage) {
    console.info(`[isolated-emulators] storage=${endpoints.storage.hostPort}`);
  }
}

/** Resolves Auth emulator host:port. Isolated mode: required + validated. Else: stock default. */
export function resolveAuthEmulatorHostPort(
  env: NodeJS.ProcessEnv = process.env,
  ports: EmulatorPortsConfig = EMULATOR_PORTS,
): string {
  if (isIsolatedEmulatorMode(env, ports)) {
    return assertIsolatedService(env.FIREBASE_AUTH_EMULATOR_HOST, 'FIREBASE_AUTH_EMULATOR_HOST', 'auth', ports).hostPort;
  }
  const raw = env.FIREBASE_AUTH_EMULATOR_HOST?.trim() || `127.0.0.1:${ports.primary.auth}`;
  return parseLoopbackHostPort(raw, 'FIREBASE_AUTH_EMULATOR_HOST').hostPort;
}

/** Resolves Emulator Hub host:port. Isolated mode: required + validated. Else: stock default. */
export function resolveEmulatorHubHostPort(
  env: NodeJS.ProcessEnv = process.env,
  ports: EmulatorPortsConfig = EMULATOR_PORTS,
): string {
  if (isIsolatedEmulatorMode(env, ports)) {
    return assertIsolatedService(env.FIREBASE_EMULATOR_HUB, 'FIREBASE_EMULATOR_HUB', 'hub', ports).hostPort;
  }
  const raw = env.FIREBASE_EMULATOR_HUB?.trim() || `127.0.0.1:${ports.primary.hub}`;
  return parseLoopbackHostPort(raw, 'FIREBASE_EMULATOR_HUB').hostPort;
}

/**
 * Functions HTTP origin. Isolated mode requires FUNCTIONS_EMULATOR_HOST on the
 * isolated functions port. Normal mode keeps the stock default and loopback checks.
 */
export function resolveFunctionsEmulatorOrigin(
  env: NodeJS.ProcessEnv = process.env,
  defaultHostPort?: string,
  ports: EmulatorPortsConfig = EMULATOR_PORTS,
): string {
  if (isIsolatedEmulatorMode(env, ports)) {
    return assertIsolatedService(env.FUNCTIONS_EMULATOR_HOST, 'FUNCTIONS_EMULATOR_HOST', 'functions', ports).origin;
  }
  const fallback = defaultHostPort ?? `127.0.0.1:${ports.primary.functions}`;
  const raw = (env.FUNCTIONS_EMULATOR_HOST ?? fallback).trim();
  return parseLoopbackHostPort(raw, 'FUNCTIONS_EMULATOR_HOST').origin;
}
