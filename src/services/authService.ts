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
import { AppError } from './errors';

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(firebase.auth);
}

export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(firebase.auth, email.trim());
}

export async function register(input: SignupInput & { email: string; password: string }): Promise<void> {
  const availability = await api.checkSignupAvailability({ subdomain: input.subdomain, email: input.email.trim() });
  if (!availability.emailAvailable) throw new AppError('error.auth.emailInUse');
  if (!availability.subdomainAvailable) throw new AppError('error.subdomainTaken');

  const cred = await createUserWithEmailAndPassword(firebase.auth, input.email.trim(), input.password);
  try {
    await sendEmailVerification(cred.user);
  } catch (e) {
    console.warn('[register] verification email failed', e);
  }
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

export async function resendVerification(): Promise<void> {
  const user = firebase.auth.currentUser;
  if (user) await sendEmailVerification(user);
}

export async function reloadUser(): Promise<User | null> {
  const user = firebase.auth.currentUser;
  if (!user) return null;
  await reload(user);
  await user.getIdToken(true);
  return firebase.auth.currentUser;
}
