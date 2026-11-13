const KEY = 'zelvero.referralCode';

/**
 * Captures a Marketing Partner's referral code from `?ref=CODE` in the URL and remembers it
 * (localStorage) until a signup consumes it. Call this once, early — on the public auth layout —
 * so the code survives navigating from the landing link to the actual signup form.
 *
 * This never trusts the code itself (it is validated server-side, in resolvePartnerReferral); it
 * only remembers which code the visitor arrived with.
 */
export function captureReferralCode(search: string): void {
  const code = new URLSearchParams(search).get('ref');
  if (!code) return;
  const trimmed = code.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(KEY, trimmed);
  } catch {
    /* private mode: the referral is simply lost, same as an ordinary signup */
  }
}

/** Reads the captured code without clearing it (an interrupted signup may resume later, on /setup). */
export function peekReferralCode(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Clears the captured code once a signup attempt has used it — it is single-use either way. */
export function clearReferralCode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
