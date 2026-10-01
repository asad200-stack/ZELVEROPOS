import isolation from '../../config/firebase-isolation.json' with { type: 'json' };

/**
 * Shared (browser + Node) validation of the Firebase web configuration.
 * Used by vite.config.ts at dev/build time and by src/firebase/config.ts at runtime.
 */
export interface IsolationProblem {
  message: string;
  /** Fatal problems stop the dev server/build immediately (old project detected, mismatches). */
  fatal: boolean;
}

export type FirebaseEnv = Record<string, string | undefined>;

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

export const BLOCKED_PROJECT_IDS: readonly string[] = isolation.blocked.projectIds;

export function isBlockedProjectId(projectId: string): boolean {
  return BLOCKED_PROJECT_IDS.map(lower).includes(lower(projectId));
}

export function isEmulatorProjectId(projectId: string): boolean {
  return lower(projectId).startsWith(isolation.emulatorProjectPrefix);
}

export function validateFirebaseEnv(env: FirebaseEnv, opts: { requireComplete: boolean }): IsolationProblem[] {
  const problems: IsolationProblem[] = [];
  const fatal = (message: string) => problems.push({ message, fatal: true });
  const warn = (message: string) => problems.push({ message, fatal: false });

  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? '';
  const expected = env.VITE_EXPECTED_FIREBASE_PROJECT_ID ?? '';
  const useEmulators = lower(env.VITE_USE_FIREBASE_EMULATORS) === 'true';
  const mentionsBlocked = (value: string | undefined) =>
    !!value && BLOCKED_PROJECT_IDS.some((id) => lower(value).includes(lower(id)));

  if (isBlockedProjectId(projectId)) fatal(`VITE_FIREBASE_PROJECT_ID "${projectId}" is the OLD CATCH POS project.`);
  if (mentionsBlocked(env.VITE_FIREBASE_AUTH_DOMAIN)) fatal('VITE_FIREBASE_AUTH_DOMAIN belongs to the OLD CATCH POS project.');
  if (mentionsBlocked(env.VITE_FIREBASE_STORAGE_BUCKET)) fatal('VITE_FIREBASE_STORAGE_BUCKET belongs to the OLD CATCH POS project.');
  if (isolation.blocked.projectNumbers.includes(String(env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? ''))) {
    fatal('VITE_FIREBASE_MESSAGING_SENDER_ID is the OLD CATCH POS project number.');
  }
  if (projectId && expected && lower(projectId) !== lower(expected)) {
    fatal(`VITE_FIREBASE_PROJECT_ID "${projectId}" does not match VITE_EXPECTED_FIREBASE_PROJECT_ID "${expected}".`);
  }
  if (useEmulators && projectId && !isEmulatorProjectId(projectId)) {
    fatal(`Emulator mode requires a "${isolation.emulatorProjectPrefix}*" project id (got "${projectId}").`);
  }
  if (isolation.placeholderProjectIds.map(lower).includes(lower(projectId)) && projectId) {
    fatal(`VITE_FIREBASE_PROJECT_ID "${projectId}" is a placeholder.`);
  }

  const required = useEmulators
    ? ['VITE_FIREBASE_PROJECT_ID']
    : [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_STORAGE_BUCKET',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_EXPECTED_FIREBASE_PROJECT_ID',
      ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    const msg = `Missing Firebase configuration: ${missing.join(', ')}.`;
    if (opts.requireComplete) fatal(msg);
    else warn(msg);
  }
  return problems;
}
