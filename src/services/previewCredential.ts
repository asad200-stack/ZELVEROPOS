/**
 * Preview POS credential. Kept in memory for this tab only.
 * Browser storage cannot select a tenant or replay this secret after reload.
 */
export interface PreviewCredential {
  credentialId: string;
  secret: string;
  tenantId: string;
  expiresAtMs: number;
}

let current: PreviewCredential | null = null;
const listeners = new Set<() => void>();

export function getPreviewCredential(): PreviewCredential | null {
  return current;
}

export function setPreviewCredential(next: PreviewCredential | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function subscribePreviewCredential(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requirePreviewCredential(): PreviewCredential {
  if (!current) throw new Error('preview-credential-missing');
  return current;
}
