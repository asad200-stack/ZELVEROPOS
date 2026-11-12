import { describe, expect, it } from 'vitest';
import { conversationStorageKey } from './engine';
import { AI_CONVERSATION_PREFIX, clearAiConversations, shouldClearAiConversation, type AiConversationBucket, type AiScope } from './conversationStore';

function bucket(seed: Record<string, string>): AiConversationBucket & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    get length() {
      return Object.keys(data).length;
    },
    key(index) {
      return Object.keys(data)[index] ?? null;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe('AI conversation privacy', () => {
  const signedIn: AiScope = { uid: 'user-a', tenantId: 'store-a' };

  it('keeps a conversation for the same signed-in store, including the first load', () => {
    expect(shouldClearAiConversation({ uid: null, tenantId: null }, { uid: null, tenantId: null })).toBe(false);
    expect(shouldClearAiConversation({ uid: null, tenantId: null }, { uid: 'user-a', tenantId: null })).toBe(false);
    expect(shouldClearAiConversation({ uid: 'user-a', tenantId: null }, signedIn)).toBe(false);
    expect(shouldClearAiConversation(signedIn, signedIn)).toBe(false);
  });

  it('clears stored chats on logout, account switch, and store switch without touching other keys', () => {
    expect(shouldClearAiConversation(signedIn, { uid: null, tenantId: null })).toBe(true);
    expect(shouldClearAiConversation(signedIn, { uid: 'user-b', tenantId: 'store-a' })).toBe(true);
    expect(shouldClearAiConversation(signedIn, { uid: 'user-a', tenantId: 'store-b' })).toBe(true);

    const session = bucket({
      [conversationStorageKey('store-a', 'user-a')]: '[{"role":"assistant","text":"Net sales: $10.00 USD"}]',
      [conversationStorageKey('store-b', 'user-a')]: '[{"role":"assistant","text":"Ali owes $5.00 USD"}]',
      'zelvero.claims.user-a': '{"tenantId":"store-a"}',
      'sidebar': 'expanded',
    });
    const persistent = bucket({
      [conversationStorageKey('store-a', 'user-a')]: 'must-stay-out-of-local-storage',
    });
    clearAiConversations(session);
    expect(session.data).toEqual({
      'zelvero.claims.user-a': '{"tenantId":"store-a"}',
      sidebar: 'expanded',
    });
    expect(persistent.data[conversationStorageKey('store-a', 'user-a')]).toContain('must-stay');
    expect(AI_CONVERSATION_PREFIX).toBe('zelvero.ai.v1.');
    expect(conversationStorageKey('store-b', 'user-b').startsWith(AI_CONVERSATION_PREFIX)).toBe(true);
  });
});
