import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import { APP_RELEASE_VERSION, STORAGE_KEYS } from '@/constants/app';
import { isAdminPreviewBuild } from '@/domain/adminPreview';
import { getPreviewCredential, subscribePreviewCredential } from '@/services/previewCredential';
import { ALL_PERMISSIONS, normalizePermissions, type PermissionKey } from '@/constants/permissions';
import { refreshVerification } from '@/services/authRefresh';
import { paths, toSubscription, toUserProfile } from '@/services/db';
import { api } from '@/services/functionsClient';
import type { Subscription, UserProfile } from '@/types/models';
import { isSubscriptionActive, SessionContext, type Claims, type Session } from './session';
import { shouldRefreshSessionToken, TOKEN_REFRESH_INTERVAL_MS } from './sessionRefresh';
import {
  isStaleAuthUid,
  refreshIdTokenUnlessStale,
  warnIfTokenRefreshFailed,
} from './sessionTokenRefresh';
import { deriveSessionStatus } from './sessionStatus';

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
    if (isAdminPreviewBuild(import.meta.env)) throw error;
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
  const [error, setError] = useState<Loaded<unknown> | null>(null);
  const claimsRepairAttempted = useRef(false);
  const lastTokenRefreshMs = useRef(0);
  const lastUid = useRef<string | null>(null);

  // Listeners of a user who just signed out fail with permission-denied; that is not this session's error.
  const reportError = useCallback((key: string, e: unknown) => {
    if (firebase.auth.currentUser?.uid !== key) return;
    setError({ key, data: e });
  }, []);

  useEffect(
    () =>
      onIdTokenChanged(firebase.auth, (u) => {
        const nextUid = u?.uid ?? null;
        if (nextUid !== lastUid.current) {
          lastUid.current = nextUid;
          setError(null);
          claimsRepairAttempted.current = false;
        }
        setUser(u);
        if (!u) {
          setClaims(null);
          return;
        }
        const startedUid = u.uid;
        loadClaims(u)
          .then((c) => {
            // Drop stale claims if the user signed out or switched during loadClaims.
            if (isStaleAuthUid(startedUid, firebase.auth.currentUser?.uid)) return;
            setClaims({ key: startedUid, data: c });
          })
          .catch((e) => reportError(startedUid, e));
      }),
    [reportError],
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
      (e) => reportError(uid, e),
    );
  }, [uid, reportError]);

  const currentClaims = claims && claims.key === uid ? claims.data : null;
  const currentProfile = profile && profile.key === uid ? profile.data : undefined;
  const previewCredential = useSyncExternalStore(subscribePreviewCredential, getPreviewCredential, () => null);
  const claimTenant = currentClaims?.tenantId ?? currentProfile?.tenantId ?? null;
  const tenantId = isAdminPreviewBuild(import.meta.env) && previewCredential ? previewCredential.tenantId : claimTenant;

  useEffect(() => {
    if (!tenantId || !uid) return;
    return onSnapshot(
      paths.subscription(tenantId),
      (snap) => {
        if (!snap.exists() && snap.metadata.fromCache) return;
        setSubscription({ key: tenantId, data: toSubscription(snap.data()) });
      },
      (e) => reportError(uid, e),
    );
  }, [tenantId, uid, reportError]);

  // Claims are written by Cloud Functions; the profile's claimsVersion tells us when to refresh.
  useEffect(() => {
    if (!user || !currentClaims || !currentProfile) return;
    if (currentProfile.claimsVersion > currentClaims.claimsVersion) {
      void refreshIdTokenUnlessStale(user, () => firebase.auth.currentUser?.uid).then(
        warnIfTokenRefreshFailed,
      );
    } else if (!currentClaims.tenantId && currentProfile.tenantId && !claimsRepairAttempted.current) {
      claimsRepairAttempted.current = true;
      const startedUid = user.uid;
      api
        .refreshMyClaims({})
        .then(async () => {
          if (isStaleAuthUid(startedUid, firebase.auth.currentUser?.uid)) return;
          warnIfTokenRefreshFailed(
            await refreshIdTokenUnlessStale(user, () => firebase.auth.currentUser?.uid),
          );
        })
        .catch((e) => {
          if (isStaleAuthUid(startedUid, firebase.auth.currentUser?.uid)) return;
          console.warn('[session] claims repair failed', e);
        });
    }
  }, [user, currentClaims, currentProfile]);

  const refreshAuthToken = useCallback((force = false) => {
    const u = firebase.auth.currentUser;
    if (!u) return;
    const online = typeof navigator === 'undefined' || navigator.onLine;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const now = Date.now();
    if (!shouldRefreshSessionToken(now, lastTokenRefreshMs.current, { online, visible, force })) return;
    lastTokenRefreshMs.current = now;
    void refreshIdTokenUnlessStale(u, () => firebase.auth.currentUser?.uid).then(
      warnIfTokenRefreshFailed,
    );
  }, []);

  useEffect(() => {
    if (currentProfile?.isActive === false) refreshAuthToken(true);
  }, [currentProfile?.isActive, refreshAuthToken]);

  useEffect(() => {
    const onVis = () => refreshAuthToken(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const id = window.setInterval(() => refreshAuthToken(false), TOKEN_REFRESH_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(id);
    };
  }, [refreshAuthToken]);

  // reload() mutates the same User object, so a counter forces the session to be recomputed.
  const [userRevision, setUserRevision] = useState(0);
  const refresh = useCallback(async () => {
    const u = firebase.auth.currentUser;
    if (!u) return false;
    const verified = await refreshVerification(u);
    setUser(firebase.auth.currentUser);
    setUserRevision((n) => n + 1);
    return verified;
  }, []);

  const value = useMemo<Session>(() => {
    const currentSub = subscription && subscription.key === tenantId ? subscription.data : null;
    const currentError = error && error.key === uid ? error.data : null;
    const isSuperAdmin = !!currentClaims?.superAdmin;
    const isOwner = currentProfile?.role === 'owner';
    const permissions = isOwner ? ALL_PERMISSIONS : normalizePermissions(currentProfile?.permissions);

    const status = deriveSessionStatus({
      user,
      claims: currentClaims,
      profile: currentProfile,
      subscription: currentSub,
      tenantId,
      error: currentError,
    });

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
      isInternalDemo: !!currentProfile && !!tenantId && currentSub?.internalDemo === true,
      permissions,
      actor,
      error: currentError,
      writesEnabled: isSubscriptionActive(currentSub),
      can: (p: PermissionKey) => permissions[p] === true,
      refresh,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- userRevision tracks in-place User mutations
  }, [user, userRevision, uid, currentClaims, currentProfile, subscription, tenantId, error, refresh]);

  useEffect(() => {
    if (!value.tenantId) return;
    try {
      localStorage.setItem(STORAGE_KEYS.lastTenantId, value.tenantId);
      localStorage.setItem(STORAGE_KEYS.lastGoodVersion, APP_RELEASE_VERSION);
    } catch {
      /* private mode */
    }
  }, [value.tenantId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
