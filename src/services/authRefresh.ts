interface RefreshableUser {
  emailVerified: boolean;
  reload(): Promise<void>;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

/**
 * One explicit check: reload the Auth user, then force a new ID token so the session (and Firestore
 * rules) see the new email_verified claim. Called only from a user action; never in a loop.
 */
export async function refreshVerification(user: RefreshableUser): Promise<boolean> {
  await user.reload();
  await user.getIdToken(true);
  return user.emailVerified === true;
}
