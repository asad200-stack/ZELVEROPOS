import { STORAGE } from './constants';

const CODE = /^[A-Za-z0-9_-]{2,40}$/;

export function parseRef(search: string): string | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('ref');
  if (!raw || !CODE.test(raw)) return null;
  return raw;
}

export function persistReferral(search: string): string | null {
  const code = parseRef(search);
  if (!code) return readReferral();
  try {
    localStorage.setItem(STORAGE.ref, code);
  } catch {
    /* private mode */
  }
  return code;
}

export function readReferral(): string | null {
  try {
    const value = localStorage.getItem(STORAGE.ref);
    return value && CODE.test(value) ? value : null;
  } catch {
    return null;
  }
}
