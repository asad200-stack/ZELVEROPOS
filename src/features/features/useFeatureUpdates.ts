import { useEffect, useState } from 'react';
import { useSession } from '@/contexts/session';
import { api, type CustomerFeatureUpdate } from '@/services/functionsClient';

interface LoadedUpdates {
  tenantId: string | null;
  updates: CustomerFeatureUpdate[];
}

const NONE: CustomerFeatureUpdate[] = [];

/**
 * This tenant's Feature Center updates. Returns an empty list while the session is not ready,
 * for the internal demo, and until the current tenant's list has loaded, so a tenant switch never
 * shows the previous tenant's updates.
 */
export function useFeatureUpdates(reloadToken = 0): CustomerFeatureUpdate[] {
  const session = useSession();
  const tenantId = session.tenantId ?? null;
  const eligible = Boolean(tenantId) && !session.isInternalDemo && session.status === 'ready';
  const [state, setState] = useState<LoadedUpdates>({ tenantId: null, updates: NONE });
  useEffect(() => {
    if (!eligible) return;
    let live = true;
    void api
      .listMyFeatureUpdates({})
      .then((result) => {
        if (live) setState({ tenantId, updates: result.updates });
      })
      .catch(() => {
        if (live) setState({ tenantId, updates: NONE });
      });
    return () => {
      live = false;
    };
  }, [eligible, tenantId, reloadToken]);
  return eligible && state.tenantId === tenantId ? state.updates : NONE;
}
