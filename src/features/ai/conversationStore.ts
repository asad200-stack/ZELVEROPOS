/**
 * AI chat lives in sessionStorage for the open tab only.
 * It is removed on logout, account switch, and store switch.
 * A reload of the same signed-in store keeps it. It is never written to localStorage.
 */
export const AI_CONVERSATION_PREFIX = 'zelvero.ai.v1.';

export interface AiScope {
  uid: string | null;
  tenantId: string | null;
}

export interface AiConversationBucket {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/** True when the previous signed-in store must not remain readable. */
export function shouldClearAiConversation(previous: AiScope, next: AiScope): boolean {
  if (previous.uid && !next.uid) return true;
  if (previous.uid && next.uid && previous.uid !== next.uid) return true;
  if (previous.uid === next.uid && previous.tenantId && next.tenantId && previous.tenantId !== next.tenantId) return true;
  return false;
}

export function clearAiConversations(storage: AiConversationBucket): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(AI_CONVERSATION_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
