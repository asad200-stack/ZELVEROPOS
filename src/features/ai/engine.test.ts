import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishedKnowledge } from './catalog';
import {
  AI_TOOLS,
  answerQuestion,
  canUse,
  conversationStorageKey,
  publishReviewed,
  shouldConsultModel,
  type KnowledgeItem,
} from './engine';
import { LOCAL_MODEL_MAX_TOKENS, localModelUrl, modelRequest, phraseWithLocalModel, visibleModelWording } from './localModel';

const owner = { question: '', lang: 'en' as const, route: '/pos', isOwner: true, isSuperAdmin: false, can: () => true };
const cashier = { ...owner, isOwner: false, can: (permission: string) => permission === 'canSell' };
const denied = { ...owner, isOwner: false, can: () => false };

describe('Zelvero AI knowledge gate', () => {
  it('publishes the reviewed local index and never an executable card', () => {
    expect(publishedKnowledge.length).toBeGreaterThan(50);
    expect(AI_TOOLS).toContain('navigate');
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    for (const item of publishedKnowledge) {
      expect(item.executes).toBe(false);
      expect(item.release.productionVerified).toBe(false);
      expect(item.release.channel).toBe('local-working-tree');
    }
  });

  it('drops stale, unreviewed, executable, and production-claimed cards', () => {
    const real = publishedKnowledge[0];
    const review = { channel: 'local-working-tree', productionVerified: false, items: [{ id: real.id, sourceHash: real.source.sha256 }] };
    expect(publishReviewed({ items: [{ ...real, source: { ...real.source, sha256: 'stale' } }] }, review)).toEqual([]);
    expect(publishReviewed({ items: [{ ...real, executes: true }] }, review)).toEqual([]);
    expect(publishReviewed({ items: [{ ...real, release: { ...real.release, productionVerified: true } }] }, review)).toEqual([]);
    expect(publishReviewed({ items: [real] }, { ...review, items: [] })).toEqual([]);
    expect(publishReviewed({ items: [real] }, { ...review, channel: 'production' })).toEqual([]);
  });

  it('answers checkout briefly without dumping sources unless asked', () => {
    const checkout = answerQuestion(publishedKnowledge, { ...cashier, question: 'How do I checkout?' });
    expect(checkout.status).toBe('answered');
    expect(checkout.executes).toBe(false);
    expect(checkout.text.toLowerCase()).toMatch(/checkout|دفع/);
    expect(checkout.text).not.toContain('This chat does not run sales');
    expect(checkout.sources).toEqual([]);
    expect(shouldConsultModel(checkout)).toBe(false);

    const withSources = answerQuestion(publishedKnowledge, { ...cashier, question: 'How do I checkout? show sources' });
    expect(withSources.sources.length).toBeGreaterThan(0);
    expect(withSources.sources.some((source) => source.path.endsWith('.test.ts'))).toBe(false);

    const unknown = answerQuestion(publishedKnowledge, { ...cashier, question: 'What is the weather on Mars?' });
    expect(unknown.status).toBe('unknown');
    expect(unknown.sources).toEqual([]);
    expect(unknown.text).not.toContain('posCheckout');
    expect(unknown.text).not.toMatch(/documented answer|جواب موثّق/i);
    expect(unknown.text).toMatch(/Zelvero POS|how-to steps|شاشات|خطوات/i);
    expect(shouldConsultModel(unknown)).toBe(false);
  });

  it('answers Arabic and mixed questions in the matching language without role-disclaimer spam', () => {
    const arabic = answerQuestion(publishedKnowledge, { ...denied, question: 'وين زر الدفع؟', lang: 'en' });
    expect(arabic.lang).toBe('ar');
    expect(arabic.text).toContain('الدفع');
    expect(arabic.text).not.toContain('صلاحيتك لا تسمح');

    const mixed = answerQuestion(publishedKnowledge, { ...owner, question: 'checkout الدفع', lang: 'en' });
    expect(mixed.lang).toBe('en');
    expect(mixed.text.toLowerCase()).toMatch(/checkout|دفع/);

    const page = answerQuestion(publishedKnowledge, { ...cashier, question: 'What can I do on this page?', route: '/pos' });
    expect(page.status).toBe('answered');
    expect(page.text.length).toBeGreaterThan(0);

    const users = answerQuestion(publishedKnowledge, { ...owner, question: 'من يقدر يفتح المستخدمين؟', lang: 'en' });
    expect(users.lang).toBe('ar');
    expect(users.text).toMatch(/users|المستخدمين|\u0645\u0633\u062a\u062e\u062f\u0645/i);

    const cashierUsers = answerQuestion(publishedKnowledge, { ...cashier, question: 'Users' });
    expect(cashierUsers.status).toBe('answered');

    const command = answerQuestion(publishedKnowledge, { ...cashier, question: 'Complete the sale now and change the stock' });
    expect(command.executes).toBe(false);
    expect(command.sources).toEqual([]);
    expect(command.text).not.toMatch(/successfully completed|sale confirmed/i);
  });

  it('keeps conversations inside one tenant and blocks remote model hosts', () => {
    expect(conversationStorageKey('store-a', 'user-1')).not.toBe(conversationStorageKey('store-b', 'user-1'));
    expect(conversationStorageKey(null, 'user-1')).not.toContain('store-a');
    expect(localModelUrl('https://api.openai.com/v1')).toBeNull();
    expect(localModelUrl('http://example.com:8081')).toBeNull();
    expect(localModelUrl('http://127.0.0.1:8081/v1?key=secret')).toBeNull();
    expect(localModelUrl(undefined)).toBe('http://127.0.0.1:8081');
    const request = modelRequest('checkout', 'Verified notes', 'en');
    expect(request).not.toHaveProperty('tools');
    expect(request.max_tokens).toBe(LOCAL_MODEL_MAX_TOKENS);
    expect(JSON.stringify(request)).not.toMatch(/sk-|firestore|firebase-admin/i);
  });

  it('ignores model thinking text and fails closed on a bad or slow response', async () => {
    expect(visibleModelWording('<think>hidden</think>\nCheckout stays a note.')).toBe('Checkout stays a note.');
    vi.stubGlobal(
      'fetch',
      async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(phraseWithLocalModel('http://127.0.0.1:8081', 'q', 'notes', 'en', 1000)).rejects.toThrow();
    vi.stubGlobal('fetch', (_input: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('missing-signal'));
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    });
    await expect(phraseWithLocalModel('http://127.0.0.1:8081', 'q', 'notes', 'en', 40)).rejects.toThrow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps checkout as an explanation, not an action the role can trigger from chat', () => {
    const checkout = publishedKnowledge.find((item) => item.id === 'callable:posCheckout');
    expect(checkout?.body.en).toContain('cannot call this function');
    expect(checkout?.executes).toBe(false);
    expect(canUse(checkout as KnowledgeItem, denied)).toBe(false);
    expect(canUse(checkout as KnowledgeItem, cashier)).toBe(true);
  });
});
