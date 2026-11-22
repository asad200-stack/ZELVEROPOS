/** Storage path of a Firebase download URL (".../o/<encoded path>?alt=media..."), or null. */
export function storagePathFromUrl(url: string): string | null {
  const m = /\/o\/([^?#]+)/.exec(url);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
