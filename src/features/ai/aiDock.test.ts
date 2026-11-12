import { describe, expect, it } from 'vitest';
import {
  aiLayerClassNames,
  aiShellClassNames,
  nextAiDockMode,
  shouldMountAiPanel,
  type AiDockMode,
} from './aiDock';
import { clearAiConversations, shouldClearAiConversation } from './conversationStore';
import { conversationStorageKey } from './engine';

describe('persistent AI dock across navigation', () => {
  it('keeps the panel mounted while open or minimized through mode changes', () => {
    let mode: AiDockMode = 'closed';
    mode = nextAiDockMode(mode, 'open');
    expect(shouldMountAiPanel(mode)).toBe(true);
    expect(aiShellClassNames(mode)).toContain('app--ai-docked');

    mode = nextAiDockMode(mode, 'minimize');
    expect(mode).toBe('minimized');
    expect(shouldMountAiPanel(mode)).toBe(true);
    expect(aiShellClassNames(mode)).toContain('app--ai-minimized');

    mode = nextAiDockMode(mode, 'restore');
    expect(mode).toBe('open');
    expect(shouldMountAiPanel(mode)).toBe(true);

    // Simulated route changes do not close the dock.
    const routes = ['/dashboard', '/products', '/customers', '/pos'];
    for (const _route of routes) {
      expect(shouldMountAiPanel(mode)).toBe(true);
      expect(aiShellClassNames(mode)).toEqual(['app--ai-docked']);
    }
  });

  it('minimize and restore preserve mount (conversation host stays alive)', () => {
    const open = nextAiDockMode('closed', 'open');
    const minimized = nextAiDockMode(open, 'minimize');
    const restored = nextAiDockMode(minimized, 'restore');
    expect(shouldMountAiPanel(open)).toBe(true);
    expect(shouldMountAiPanel(minimized)).toBe(true);
    expect(shouldMountAiPanel(restored)).toBe(true);
    expect(nextAiDockMode(minimized, 'close')).toBe('closed');
    expect(shouldMountAiPanel('closed')).toBe(false);
  });

  it('RTL dock classes stay usable and do not force a full-screen modal shell', () => {
    const ltr = aiLayerClassNames('open', false);
    const rtl = aiLayerClassNames('open', true);
    expect(ltr).toContain('ai-layer--docked');
    expect(rtl).toContain('ai-layer--docked');
    expect(rtl).toContain('ai-layer--rtl');
    expect(ltr.join(' ')).not.toMatch(/modal-fullscreen|ai-layer--modal-only/);
    const mobileMinimized = aiLayerClassNames('minimized', true);
    expect(mobileMinimized).toContain('ai-layer--minimized');
  });

  it('pending-offer host remains mounted after open → navigate-equivalent mode hold', () => {
    // App shell keeps AiPanel mounted whenever shouldMountAiPanel is true;
    // pending offers live in AiPanel refs and survive route changes.
    expect(shouldMountAiPanel(nextAiDockMode('open', 'minimize'))).toBe(true);
    expect(shouldMountAiPanel('open')).toBe(true);
  });

  it('tenant changes and logout clear prior conversation storage keys', () => {
    const store = new Map<string, string>();
    const bucket = {
      get length() {
        return store.size;
      },
      key(index: number) {
        return [...store.keys()][index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    };
    const a = conversationStorageKey('tenant-a', 'user-1');
    const b = conversationStorageKey('tenant-b', 'user-1');
    bucket.setItem(a, JSON.stringify([{ role: 'user', text: 'secret-a' }]));
    bucket.setItem(b, JSON.stringify([{ role: 'user', text: 'secret-b' }]));
    expect(shouldClearAiConversation({ uid: 'user-1', tenantId: 'tenant-a' }, { uid: 'user-1', tenantId: 'tenant-b' })).toBe(
      true,
    );
    clearAiConversations(bucket);
    expect(store.size).toBe(0);
    expect(shouldClearAiConversation({ uid: 'user-1', tenantId: 'tenant-a' }, { uid: null, tenantId: null })).toBe(true);
  });
});
