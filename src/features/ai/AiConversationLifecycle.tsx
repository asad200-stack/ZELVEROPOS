import { useEffect, useRef } from 'react';
import { useSession } from '@/contexts/session';
import { clearAiConversations, shouldClearAiConversation, type AiScope } from './conversationStore';

/** Drops stored AI chats when the signed-in user or store changes. A first load does not. */
export function AiConversationLifecycle() {
  const session = useSession();
  const scope = useRef<AiScope>({ uid: null, tenantId: null });
  const uid = session.user?.uid ?? null;
  const tenantId = session.tenantId;

  useEffect(() => {
    const next = { uid, tenantId };
    if (shouldClearAiConversation(scope.current, next)) clearAiConversations(sessionStorage);
    scope.current = next;
  }, [uid, tenantId]);

  return null;
}
