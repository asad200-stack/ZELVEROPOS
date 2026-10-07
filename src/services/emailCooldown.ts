/**
 * Client-side throttle for Firebase Auth e-mails (verification, password reset). Firebase rejects
 * repeated sendOobCode calls for the same account with auth/too-many-requests, so every send goes
 * through here: one attempt per cooldown, a long back-off after a rate-limit answer, and the timestamps
 * live in localStorage so a page reload cannot bypass them. It never sends on its own.
 */

export const RESEND_COOLDOWN_MS = 60_000;
export const RATE_LIMIT_BACKOFF_MS = 10 * 60_000;
const PREFIX = 'zelvero.emailCooldown.';

export type EmailKind = 'verify' | 'reset';

export interface CooldownStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Entry {
  /** Earliest time another send may be attempted. */
  until: number;
  rateLimited: boolean;
}

export type SendOutcome =
  | { status: 'sent'; retryAt: number }
  | { status: 'cooldown'; retryAt: number }
  | { status: 'rateLimited'; retryAt: number }
  | { status: 'failed'; retryAt: number; error: unknown };

export function isRateLimitError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'auth/too-many-requests' || /TOO_MANY_ATTEMPTS_TRY_LATER/.test(e?.message ?? '');
}

function safeStorage(): CooldownStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class EmailCooldown {
  /** In-flight sends per key, so double clicks inside one tab share one request. */
  private readonly inflight = new Map<string, Promise<SendOutcome>>();

  constructor(
    private readonly store: CooldownStore | null = safeStorage(),
    private readonly now: () => number = Date.now,
  ) {}

  private key(kind: EmailKind, subject: string): string {
    return `${PREFIX}${kind}.${subject}`;
  }

  private read(key: string): Entry | null {
    try {
      const raw = this.store?.getItem(key);
      const e = raw ? (JSON.parse(raw) as Entry) : null;
      return e && typeof e.until === 'number' ? e : null;
    } catch {
      return null;
    }
  }

  private write(key: string, entry: Entry): void {
    try {
      this.store?.setItem(key, JSON.stringify(entry));
    } catch {
      /* storage full or blocked: the in-memory in-flight guard still applies */
    }
  }

  /** Milliseconds until a send is allowed again (0 = allowed) and whether the wait is a rate-limit back-off. */
  status(kind: EmailKind, subject: string): { remainingMs: number; rateLimited: boolean } {
    const e = this.read(this.key(kind, subject));
    const remainingMs = e ? Math.max(0, e.until - this.now()) : 0;
    return { remainingMs, rateLimited: remainingMs > 0 && !!e?.rateLimited };
  }

  /** Record a send that happened elsewhere (e.g. the automatic one at signup). */
  recordAttempt(kind: EmailKind, subject: string, error?: unknown): void {
    const limited = error !== undefined && isRateLimitError(error);
    this.write(this.key(kind, subject), { until: this.now() + (limited ? RATE_LIMIT_BACKOFF_MS : RESEND_COOLDOWN_MS), rateLimited: limited });
  }

  /** Runs `send` only if no cooldown is active; any attempt (success or failure) starts a new cooldown. */
  send(kind: EmailKind, subject: string, send: () => Promise<void>): Promise<SendOutcome> {
    const key = this.key(kind, subject);
    const running = this.inflight.get(key);
    if (running) return running;
    const { remainingMs, rateLimited } = this.status(kind, subject);
    if (remainingMs > 0) return Promise.resolve({ status: rateLimited ? 'rateLimited' : 'cooldown', retryAt: this.now() + remainingMs });

    this.recordAttempt(kind, subject);
    const p = (async (): Promise<SendOutcome> => {
      try {
        await send();
        return { status: 'sent', retryAt: this.now() + RESEND_COOLDOWN_MS };
      } catch (error) {
        this.recordAttempt(kind, subject, error);
        const retryAt = this.now() + this.status(kind, subject).remainingMs;
        return isRateLimitError(error) ? { status: 'rateLimited', retryAt } : { status: 'failed', retryAt, error };
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}

export const emailCooldown = new EmailCooldown();
