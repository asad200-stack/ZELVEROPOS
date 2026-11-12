import type { FirebaseOptions } from 'firebase/app';
import {
  isEmulatorIsolatedEnabled,
  resolveIsolatedEmulatorEndpoints,
  validateEmulatorIsolatedEnv,
  type IsolatedEmulatorEndpoints,
} from './emulatorIsolated';
import { isEmulatorProjectId, validateFirebaseEnv, type IsolationProblem } from './isolation';
import { isSuperAdminPreviewChannel } from './superadminPreview';

export interface ResolvedFirebaseConfig {
  options: FirebaseOptions;
  projectId: string;
  functionsRegion: string;
  useEmulators: boolean;
  /** True when the isolated alternate-port harness is active. */
  isolatedEmulators: boolean;
  /** Exact extra demo-* project permitted by the isolated harness. Empty in normal runs. */
  isolatedAllowProject: string;
  /** Set only for isolated harness; primary emulator mode keeps null and uses stock ports in app.ts. */
  isolatedEndpoints: IsolatedEmulatorEndpoints | null;
  appCheckSiteKey: string;
}

export class FirebaseConfigError extends Error {
  readonly problems: IsolationProblem[];
  constructor(problems: IsolationProblem[]) {
    super(problems.map((p) => p.message).join('\n'));
    this.name = 'FirebaseConfigError';
    this.problems = problems;
  }
}

type EnvLike = Record<string, string | undefined>;

/**
 * Pure resolver for unit tests and runtime. Never connects to Firebase.
 */
export function resolveFirebaseConfigFromEnv(env: EnvLike): ResolvedFirebaseConfig {
  const problems = [
    ...validateFirebaseEnv(env, { requireComplete: true }),
    ...validateEmulatorIsolatedEnv(env),
  ];
  if (problems.length) throw new FirebaseConfigError(problems);

  const useEmulators = String(env.VITE_USE_FIREBASE_EMULATORS).toLowerCase() === 'true';
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID);
  if (useEmulators && !isEmulatorProjectId(projectId)) {
    throw new FirebaseConfigError([{ message: 'Emulator mode requires a demo-* project id.', fatal: true }]);
  }
  const channel = String(env.VITE_APP_CHANNEL).toLowerCase();
  if (channel === 'preview' && (!useEmulators || !isEmulatorProjectId(projectId))) {
    throw new FirebaseConfigError([{ message: 'Preview channel only runs against a demo-* emulator project.', fatal: true }]);
  }
  if (isSuperAdminPreviewChannel(channel)) {
    throw new FirebaseConfigError([{ message: 'The separate preview channel is retired. Use the Super Admin Preview tab.', fatal: true }]);
  }
  if (String(env.VITE_ADMIN_PREVIEW).toLowerCase() === 'true' && (useEmulators || isEmulatorProjectId(projectId))) {
    throw new FirebaseConfigError([{ message: 'The admin preview build cannot use the emulators.', fatal: true }]);
  }

  const isolatedEmulators = isEmulatorIsolatedEnabled(env);
  const isolatedEndpoints = isolatedEmulators ? resolveIsolatedEmulatorEndpoints(env) : null;

  return {
    projectId,
    useEmulators,
    isolatedEmulators,
    isolatedAllowProject: String(env.VITE_EMULATOR_ALLOW_DEMO_PROJECT ?? '').trim(),
    isolatedEndpoints,
    functionsRegion: env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1',
    appCheckSiteKey: env.VITE_FIREBASE_APPCHECK_SITE_KEY || '',
    options: {
      apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || (useEmulators ? `${projectId}.appspot.com` : undefined),
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
      appId: env.VITE_FIREBASE_APP_ID || undefined,
    },
  };
}

/**
 * Reads the Firebase web config from Vite environment variables and refuses to continue when it
 * is incomplete or points at the old CATCH POS project. Never hardcode credentials here.
 */
export function resolveFirebaseConfig(): ResolvedFirebaseConfig {
  return resolveFirebaseConfigFromEnv(import.meta.env as unknown as EnvLike);
}
