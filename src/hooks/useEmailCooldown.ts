import { useEffect, useState } from 'react';
import { emailCooldown, type EmailKind } from '@/services/emailCooldown';

/** Seconds left on an e-mail cooldown. Re-renders once per second only while a cooldown runs; never contacts Firebase. */
export function useEmailCooldown(kind: EmailKind, subject: string | null) {
  const [, setTick] = useState(0);
  const { remainingMs, rateLimited } = subject ? emailCooldown.status(kind, subject) : { remainingMs: 0, rateLimited: false };
  const active = remainingMs > 0;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return {
    seconds: Math.ceil(remainingMs / 1000),
    rateLimited,
    /** Re-read immediately after a send attempt. */
    sync: () => setTick((n) => n + 1),
  };
}
