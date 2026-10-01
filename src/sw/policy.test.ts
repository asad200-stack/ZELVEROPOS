import { describe, expect, it } from 'vitest';
import { cachesToDelete, precacheList, routeRequest, shellCacheName } from './policy';

const ORIGIN = 'https://zelvoropos.web.app';
const PRECACHE = new Set(['/index.html', '/assets/index-abc.js', '/assets/index-abc.css', '/manifest.webmanifest', '/favicon.ico', '/icons/icon-192.png']);
const get = (url: string, mode = 'no-cors') => routeRequest({ url, method: 'GET', mode }, ORIGIN, PRECACHE);

describe('service worker request policy', () => {
  it('serves the app shell for navigations to every client route (deep links)', () => {
    for (const path of ['/', '/pos', '/products', '/sales', '/sales/abc123', '/customers', '/settings', '/index.html', '/pos?tab=cart']) {
      expect(get(`${ORIGIN}${path}`, 'navigate')).toBe('shell');
    }
  });

  it('serves precached build files and hashed assets from the cache', () => {
    expect(get(`${ORIGIN}/assets/index-abc.js`)).toBe('asset');
    expect(get(`${ORIGIN}/assets/PosPage-xyz.js`)).toBe('asset');
    expect(get(`${ORIGIN}/manifest.webmanifest`)).toBe('asset');
    expect(get(`${ORIGIN}/icons/icon-192.png`)).toBe('asset');
  });

  it('never intercepts Firebase, Google or any other cross-origin traffic', () => {
    const urls = [
      'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?database=x',
      'https://europe-west1-zelvoropos.cloudfunctions.net/posCheckout',
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k',
      'https://securetoken.googleapis.com/v1/token?key=k',
      'https://firebasestorage.googleapis.com/v0/b/zelvoropos.appspot.com/o/logo.png?alt=media&token=t',
      'https://www.googleapis.com/anything',
      'https://www.google.com/recaptcha/api.js',
      'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen',
      'http://127.0.0.1:5001/demo-zelvero/europe-west1/posCheckout',
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
      'http://127.0.0.1:9199/v0/b/bucket/o/x',
    ];
    for (const url of urls) {
      expect(get(url)).toBe('network');
      expect(get(url, 'navigate')).toBe('network');
    }
  });

  it('never intercepts non-GET requests, even same-origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(routeRequest({ url: `${ORIGIN}/assets/index-abc.js`, method, mode: 'cors' }, ORIGIN, PRECACHE)).toBe('network');
      expect(routeRequest({ url: `${ORIGIN}/pos`, method, mode: 'navigate' }, ORIGIN, PRECACHE)).toBe('network');
    }
  });

  it("leaves Firebase Hosting's reserved paths, query URLs, unknown files and file navigations to the network", () => {
    expect(get(`${ORIGIN}/__/auth/handler?apiKey=k`, 'navigate')).toBe('network');
    expect(get(`${ORIGIN}/__/firebase/init.json`)).toBe('network');
    expect(get(`${ORIGIN}/assets/index-abc.js?v=2`)).toBe('network');
    expect(get(`${ORIGIN}/robots.txt`)).toBe('network');
    expect(get(`${ORIGIN}/export.csv`, 'navigate')).toBe('network');
    expect(get('not a url')).toBe('network');
  });
});

describe('service worker cache versioning', () => {
  it('keeps the current and the previous shell cache and deletes older ones', () => {
    const keys = [shellCacheName('v1'), shellCacheName('v2'), shellCacheName('v3'), 'zelvero-sw-meta', 'unrelated-cache'];
    expect(cachesToDelete(keys, shellCacheName('v3'), shellCacheName('v2'))).toEqual([shellCacheName('v1')]);
    expect(cachesToDelete(keys, shellCacheName('v3'), null)).toEqual([shellCacheName('v1'), shellCacheName('v2')]);
  });

  it('precaches every build file except source maps, hidden files and the worker itself', () => {
    expect(precacheList(['index.html', 'sw.js', 'assets\\app-1.js', 'assets/app-1.js.map', '.vite/manifest.json', 'favicon.ico'])).toEqual([
      '/assets/app-1.js',
      '/favicon.ico',
      '/index.html',
    ]);
  });
});
