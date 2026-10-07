export type ActionMode = 'verifyEmail' | 'resetPassword' | 'recoverEmail';

export interface ActionParams {
  mode: ActionMode;
  oobCode: string;
  /** Same-origin path to continue to afterwards (never an external URL). */
  continuePath: string;
}

const MODES: readonly string[] = ['verifyEmail', 'resetPassword', 'recoverEmail'];

/** Parses a Firebase e-mail action link. Returns null for unsupported or malformed links. */
export function parseActionParams(search: string, origin: string): ActionParams | null {
  const q = new URLSearchParams(search);
  const mode = q.get('mode') ?? '';
  const oobCode = q.get('oobCode') ?? '';
  if (!MODES.includes(mode) || !/^[A-Za-z0-9_-]{10,2048}$/.test(oobCode)) return null;
  return { mode: mode as ActionMode, oobCode, continuePath: safeContinuePath(q.get('continueUrl'), origin) };
}

function safeContinuePath(raw: string | null, origin: string): string {
  if (!raw) return '/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) return '/';
    if (url.pathname.startsWith('/auth/action')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

/** Firebase errors that mean "this link is no good" rather than a technical failure. */
export function isDeadLinkError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return ['auth/expired-action-code', 'auth/invalid-action-code', 'auth/user-not-found', 'auth/user-disabled'].includes(code);
}

/** Action codes are single-use: one in-flight Firebase call per code, even if the screen mounts twice. */
const once = new Map<string, Promise<unknown>>();
export function runOnce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = once.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    once.set(key, p);
  }
  return p;
}
