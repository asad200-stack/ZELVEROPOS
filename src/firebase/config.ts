import type { FirebaseOptions } from 'firebase/app';
import { isEmulatorProjectId, validateFirebaseEnv, type IsolationProblem } from './isolation';

export interface ResolvedFirebaseConfig {
  options: FirebaseOptions;
  projectId: string;
  functionsRegion: string;
  useEmulators: boolean;
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

const env = import.meta.env;

/**
 * Reads the Firebase web config from Vite environment variables and refuses to continue when it
 * is incomplete or points at the old CATCH POS project. Never hardcode credentials here.
 */
export function resolveFirebaseConfig(): ResolvedFirebaseConfig {
  const problems = validateFirebaseEnv(env as unknown as Record<string, string>, { requireComplete: true });
  if (problems.length) throw new FirebaseConfigError(problems);

  const useEmulators = String(env.VITE_USE_FIREBASE_EMULATORS).toLowerCase() === 'true';
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID);
  if (useEmulators && !isEmulatorProjectId(projectId)) {
    throw new FirebaseConfigError([{ message: 'Emulator mode requires a demo-* project id.', fatal: true }]);
  }

  return {
    projectId,
    useEmulators,
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
