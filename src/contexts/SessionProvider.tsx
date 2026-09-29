import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import { ALL_PERMISSIONS, normalizePermissions, type PermissionKey } from '@/constants/permissions';
import { paths, toSubscription, toUserProfile } from '@/services/db';
import { api } from '@/services/functionsClient';
import type { Subscription, UserProfile } from '@/types/models';
import { isSubscriptionActive, SessionContext, type Claims, type Session, type SessionStatus } from './session';

const CLAIMS_CACHE_KEY = 'zelvero.claims.';

function parseClaims(raw: Record<string, unknown>): Claims {
  return {
    tenantId: typeof raw.tenantId === 'string' ? raw.tenantId : null,
    role: raw.role === 'owner' || raw.role === 'subUser' ? raw.role : null,
    superAdmin: raw.superAdmin === true,
    active: raw.active === true,
    subUntil: typeof raw.subUntil === 'number' ? raw.subUntil : 0,
    claimsVersion: typeof raw.cv === 'number' ? raw.cv : 0,
  };
}

/** Reads claims; when offline with an expired token, falls back to the last known claims. */
async function loadClaims(user: User): Promise<Claims> {
  const key = CLAIMS_CACHE_KEY + user.uid;
  try {
    const result = await user.getIdTokenResult();
    const claims = parseClaims(result.claims);
    try {
      localStorage.setItem(key, JSON.stringify(claims));
    } catch {
      /* ignore */
    }
    return claims;
  } catch (error) {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached) as Claims;
    throw error;
  }
}

interface Loaded<T> {
  key: string;
  data: T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [claims, setClaims] = useState<Loaded<Claims> | null>(null);
  const [profile, setProfile] = useState<Loaded<UserProfile | null> | null>(null);
  const [subscription, setSubscription] = useState<Loaded<Subscription> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const claimsRepairAttempted = useRef(false);

  useEffect(
    () =>
      onIdTokenChanged(firebase.auth, (u) => {
        setUser(u);
        if (!u) {
          setClaims(null);
          return;
        }
        loadClaims(u)
          .then((c) => setClaims({ key: u.uid, data: c }))
          .catch((e) => setError(e));
      }),
    [],
  );

  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      paths.user(uid),
      { includeMetadataChanges: false },
      (snap) => {
        if (!snap.exists() && snap.metadata.fromCache) return;
        setProfile({ key: uid, data: snap.exists() ? toUserProfile(uid, snap.data()) : null });
      },
      (e) => setError(e),
    );
  }, [uid]);

  const currentClaims = claims && claims.key === uid ? claims.data : null;
  const currentProfile = profile && profile.key === uid ? profile.data : undefined;
  const tenantId = currentClaims?.tenantId ?? currentProfile?.tenantId ?? null;

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      paths.subscription(tenantId),
      (snap) => {
        if (!snap.exists() && snap.metadata.fromCache) return;
        setSubscription({ key: tenantId, data: toSubscription(snap.data()) });
      },
      (e) => setError(e),
    );
  }, [tenantId]);

  // Claims are written by Cloud Functions; the profile's claimsVersion tells us when to refresh.
  useEffect(() => {
    if (!user || !currentClaims || !currentProfile) return;
    if (currentProfile.claimsVersion > currentClaims.claimsVersion) {
      user.getIdToken(true).catch((e) => console.warn('[session] token refresh failed', e));
    } else if (!currentClaims.tenantId && currentProfile.tenantId && !claimsRepairAttempted.current) {
      claimsRepairAttempted.current = true;
      api
        .refreshMyClaims({})
        .then(() => user.getIdToken(true))
        .catch((e) => console.warn('[session] claims repair failed', e));
    }
  }, [user, currentClaims, currentProfile]);

  const refresh = useCallback(async () => {
    const u = firebase.auth.currentUser;
    if (!u) return;
    await u.reload();
    await u.getIdToken(true);
    setUser(firebase.auth.currentUser);
  }, []);

  const value = useMemo<Session>(() => {
    const currentSub = subscription && subscription.key === tenantId ? subscription.data : null;
    const isSuperAdmin = !!currentClaims?.superAdmin;
    const isOwner = currentProfile?.role === 'owner';
    const permissions = isOwner ? ALL_PERMISSIONS : normalizePermissions(currentProfile?.permissions);

    let status: SessionStatus;
    if (error && !currentClaims) status = 'error';
    else if (user === undefined) status = 'loading';
    else if (user === null) status = 'signedOut';
    else if (!currentClaims) status = 'loading';
    else if (isSuperAdmin && !tenantId) status = 'ready';
    else if (!user.emailVerified) status = 'needsVerification';
    else if (currentProfile === undefined) status = 'loading';
    else if (currentProfile === null) status = 'needsSetup';
    else if (!currentProfile.isActive) status = 'disabled';
    else if (!currentSub) status = 'loading';
    else if (!isSubscriptionActive(currentSub)) status = 'inactive';
    else status = 'ready';

    const actor =
      user && tenantId && currentProfile
        ? { tenantId, uid: user.uid, name: currentProfile.fullName || user.email || user.uid }
        : null;

    return {
      status,
      user: user ?? null,
      profile: currentProfile ?? null,
      claims: currentClaims,
      subscription: currentSub,
      tenantId: currentProfile ? tenantId : null,
      isOwner,
      isSuperAdmin,
      permissions,
      actor,
      error,
      can: (p: PermissionKey) => permissions[p] === true,
      refresh,
    };
  }, [user, currentClaims, currentProfile, subscription, tenantId, error, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
