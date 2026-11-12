import { isTestTrialEmail } from './salesModel.js';
import { verificationEmailConfigured } from './verificationEmail.js';

export type SalesMode = 'off' | 'staging' | 'on';

/** Staging accepts only the reserved test domain. Public mode still has to pass delivery. */
export function trialSignupAllowed(mode: SalesMode, email: string): boolean {
  if (mode === 'on') return true;
  if (mode === 'staging' && isTestTrialEmail(email)) return true;
  return false;
}

/**
 * A real customer address needs a configured mailbox provider. Reserved test addresses are
 * used only by the emulator and never receive a verification message.
 */
export function trialDeliveryAllowed(email: string): boolean {
  if (isTestTrialEmail(email)) return true;
  return verificationEmailConfigured();
}

export { displayedTrialStatus } from './shared/trial.js';

/** Fields the public callable may return. Internal ids stay in Firestore. */
export function publicTrialResult(result: Record<string, unknown> | null | undefined): {
  ok: true;
  referralAccepted: boolean;
  resumable: boolean;
} {
  const source = result ?? {};
  return {
    ok: true,
    referralAccepted: source.referralAccepted === true,
    resumable: source.resumable === true,
  };
}
