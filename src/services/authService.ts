import {
  createUserWithEmailAndPassword,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { firebase } from '@/firebase/app';
import { api, type SignupInput } from './functionsClient';
import { emailCooldown, type SendOutcome } from './emailCooldown';
import { AppError } from './errors';

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(firebase.auth);
}

/** One reset e-mail per cooldown per browser (keyed without the address, so nothing personal is stored). */
export function sendPasswordReset(email: string): Promise<SendOutcome> {
  return emailCooldown.send('reset', 'browser', () => sendPasswordResetEmail(firebase.auth, email.trim()));
}

export async function register(input: SignupInput & { email: string; password: string }): Promise<void> {
  const availability = await api.checkSignupAvailability({ subdomain: input.subdomain });
  if (!availability.subdomainAvailable) throw new AppError('error.subdomainTaken');

  const cred = await createUserWithEmailAndPassword(firebase.auth, input.email.trim(), input.password);
  const sent = await emailCooldown.send('verify', cred.user.uid, () => sendEmailVerification(cred.user));
  if (sent.status === 'failed' || sent.status === 'rateLimited') console.warn('[register] verification email not sent:', sent.status);
  await completeSignup({
    fullName: input.fullName,
    storeName: input.storeName,
    subdomain: input.subdomain,
    phone: input.phone,
  });
}

/** Creates the tenant server-side (idempotent) and refreshes the ID token to pick up claims. */
export async function completeSignup(input: SignupInput): Promise<void> {
  await api.completeSignup(input);
  await firebase.auth.currentUser?.getIdToken(true);
}

/** Only ever called from an explicit user click; the cooldown decides whether Firebase is contacted. */
export function resendVerification(): Promise<SendOutcome> {
  const user = firebase.auth.currentUser;
  if (!user) return Promise.resolve({ status: 'cooldown', retryAt: Date.now() });
  return emailCooldown.send('verify', user.uid, () => sendEmailVerification(user));
}

export function verificationCooldown(uid: string) {
  return emailCooldown.status('verify', uid);
}

/** One reload of the Auth user plus a forced token refresh. */
export async function reloadUser(): Promise<User | null> {
  const user = firebase.auth.currentUser;
  if (!user) return null;
  await reload(user);
  await user.getIdToken(true);
  return firebase.auth.currentUser;
}
