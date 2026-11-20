import { domainProblem, normalizeDomain } from '@/domain/onlineStore';

/**
 * Whether this page was opened on a shop's own domain. Off unless the build opts in with
 * VITE_STORE_CUSTOM_DOMAINS=true, and never for the app's own hosts (VITE_APP_HOSTS plus the
 * platform hosts that domainProblem() reserves), so the POS itself is never affected.
 */
export function customStoreHost(env: ImportMetaEnv, hostname: string): string | null {
  if (env.VITE_STORE_CUSTOM_DOMAINS !== 'true') return null;
  const host = normalizeDomain(hostname);
  const appHosts = String(env.VITE_APP_HOSTS ?? '')
    .split(',')
    .map((h) => normalizeDomain(h))
    .filter(Boolean);
  if (!host || appHosts.includes(host) || domainProblem(host)) return null;
  return host;
}
