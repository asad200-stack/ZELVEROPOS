import { isIP } from 'node:net';

/**
 * Shared bucket for requests that do not carry a platform-observed address.
 * One key, not a new key per malformed header, so a caller cannot dodge the limit
 * by sending garbage.
 */
export const MISSING_CLIENT_IP = 'missing';

function validIp(value: string): string | null {
  let text = value.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text || isIP(text) === 0) return null;
  return text.toLowerCase();
}

/** Every syntactically valid address in X-Forwarded-For, left to right. */
export function forwardedAddresses(header: string | string[] | undefined): string[] {
  const parts = (Array.isArray(header) ? header.join(',') : header || '').split(',');
  const out: string[] = [];
  for (const part of parts) {
    const ip = validIp(part);
    if (ip) out.push(ip);
  }
  return out;
}

/**
 * Client address for Cloud Functions (2nd gen) on Cloud Run.
 *
 * These callables are requested at *.cloudfunctions.net. Cloud Run appends the
 * address it actually accepted the connection from as the last X-Forwarded-For
 * hop. Earlier hops are whatever the caller wrote and are ignored.
 *
 * The socket address is only a fallback when that header has no valid address.
 * Inside Cloud Run the socket peer is the platform proxy, so this fallback is
 * not the browser. A missing or invalid address uses one shared key.
 *
 * If a request is later proxied through Firebase Hosting, the last hop can be
 * the CDN rather than the browser. The marketing client does not use that path.
 * This is not App Check and it is not authentication.
 */
export function platformClientIp(input: {
  forwardedFor?: string | string[] | undefined;
  socketAddress?: string | null;
}): string {
  const hops = forwardedAddresses(input.forwardedFor);
  const observed = hops.length ? hops[hops.length - 1] : null;
  if (observed) return observed;
  const socket = validIp(input.socketAddress || '');
  return socket || MISSING_CLIENT_IP;
}
