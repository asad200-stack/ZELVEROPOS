import { useSyncExternalStore } from 'react';

/**
 * Registers the app-shell service worker (production builds only) and exposes "a new version is
 * ready" to the UI. Updates never apply by themselves: the new worker waits until the user chooses
 * to refresh, so a running sale is never interrupted by a reload.
 */

const UPDATE_CHECK_MS = 30 * 60_000;

let updateReady = false;
let registration: ServiceWorkerRegistration | null = null;
let reloadRequested = false;
const listeners = new Set<() => void>();

function setUpdateReady() {
  if (updateReady) return;
  updateReady = true;
  listeners.forEach((l) => l());
}

export function shouldRegisterServiceWorker(env: { PROD?: boolean; VITE_APP_CHANNEL?: string }): boolean {
  return env.PROD === true && env.VITE_APP_CHANNEL !== 'preview';
}

export function registerServiceWorker(): void {
  if (!shouldRegisterServiceWorker(import.meta.env) || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // Without a controller at startup this is the first install; its takeover is not an update.
  const hadController = !!sw.controller;

  sw.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
    else if (hadController) setUpdateReady();
  });

  const register = async () => {
    try {
      const base = import.meta.env.BASE_URL || '/';
      const swUrl = new URL('sw.js', `${location.origin}${base}`).pathname;
      const reg = await sw.register(swUrl, { updateViaCache: 'none', scope: base });
      registration = reg;
      if (reg.waiting && sw.controller) setUpdateReady();
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && sw.controller) setUpdateReady();
        });
      });
      const check = () => {
        if (navigator.onLine) reg.update().catch(() => undefined);
      };
      setInterval(check, UPDATE_CHECK_MS);
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    } catch (error) {
      console.warn('[sw] registration failed', error);
    }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

/** Activates the waiting version and reloads this tab. Only ever called from an explicit user action. */
export function applyUpdate(): void {
  reloadRequested = true;
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => window.location.reload(), 3000);
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => updateReady,
    () => false,
  );
}

/* ------------------------------------------ cashier work that a refresh would interrupt */

const work = new Map<string, boolean>();

/** Screens report unfinished work (a cart with items, a sale being submitted) under their own key. */
export function setWorkInProgress(key: string, active: boolean): void {
  if (active) work.set(key, true);
  else work.delete(key);
}

export function hasWorkInProgress(): boolean {
  return work.size > 0;
}
