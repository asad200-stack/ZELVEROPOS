import { useEffect, useState, type ReactNode } from 'react';
import { PageLoader } from '@/components/ui/Spinner';
import { api } from '@/services/functionsClient';
import { setPreviewCredential } from '@/services/previewCredential';

/**
 * Loads the server-minted preview credential before tenant screens mount.
 * The returned tenant id is the one the server resolved. It is not chosen here.
 */
export function PreviewAccess({ children, denied }: { children: ReactNode; denied: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .issuePreviewCredential({})
      .then((credential) => {
        if (cancelled) return;
        setPreviewCredential(credential);
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewCredential(null);
        setState('denied');
      });
    return () => {
      cancelled = true;
      setPreviewCredential(null);
    };
  }, []);

  if (state === 'loading') return <PageLoader />;
  if (state === 'denied') return denied;
  return children;
}
