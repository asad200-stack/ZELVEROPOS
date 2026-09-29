import { onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import type { UserProfile } from '@/types/models';
import { paths, toUserProfile } from './db';

/** Live list of the tenant's sub-users (owner only; enforced by rules). */
export function watchSubUsers(tenantId: string, onData: (users: UserProfile[]) => void, onError: (e: unknown) => void) {
  return onSnapshot(
    query(paths.users(), where('tenantId', '==', tenantId), where('role', '==', 'subUser')),
    (snap) => onData(snap.docs.map((d) => toUserProfile(d.id, d.data())).sort((a, b) => a.fullName.localeCompare(b.fullName))),
    onError,
  );
}

export async function updateOwnName(uid: string, fullName: string): Promise<void> {
  await updateDoc(paths.user(uid), { fullName: fullName.trim() });
}
