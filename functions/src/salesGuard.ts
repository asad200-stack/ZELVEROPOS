/**
 * Decides whether a public website-sales call may write.
 *
 * The project id comes from the server environment only. Request fields cannot select a project,
 * a tenant, or an environment. Origin and Referer are not authentication: a caller can forge them.
 * They only name the page the browser claims to be on. Public callables still need a separate
 * Firebase App Check review before those headers can be treated as a bot or client check.
 *
 * On project zelvoropos the only accepted page origin is the customer Marketing site
 * https://zelvero-web-staging.web.app. The match is the parsed origin (scheme, host, and port),
 * not a hostname substring. Isolated staging sites, localhost, the POS site, and any other origin
 * are refused. If Origin is present it must be that exact origin; an approved Referer cannot
 * override a missing, malformed, or different Origin. A path on the approved origin is the same
 * origin and is accepted.
 *
 * On any other project, including zelvoropos-stage, this allow-list does not run. Those functions
 * write only in the project they are deployed to.
 *
 * On project zelvoropos, @zelvero.test identities are refused before Auth or Firestore writes.
 * Real lead and quote intake still follows WEBSITE_SALES_MODE (`staging` accepts those leads;
 * `on` also accepts real trial signups). This file does not deploy anything.
 */
export const PRODUCTION_SALES_PROJECT = 'zelvoropos';

/** Customer Marketing site currently used for registration and subscriptions. */
export const PRODUCTION_MARKETING_ORIGIN = 'https://zelvero-web-staging.web.app';

/**
 * Hosts that must not call production website sales. The customer Marketing origin above is
 * intentionally absent: its hostname contains "staging" but it is the live marketing site.
 */
export const STAGING_SALES_HOSTS = [
  'zelvero-web-staging.firebaseapp.com',
  'zelvoropos-staging.web.app',
  'zelvoropos-staging.firebaseapp.com',
  'zelvoropos-stage.web.app',
  'zelvoropos-stage.firebaseapp.com',
  'zelvoropos-stage-web.web.app',
  'zelvoropos-stage-web.firebaseapp.com',
  'localhost',
  '127.0.0.1',
  '::1',
] as const;

const TEST_EMAIL = /@zelvero\.test$/i;

export type SalesWriteBlock = 'staging-origin' | 'unapproved-origin' | 'test-identity' | 'unknown-project' | 'missing-browser-host';

export type SalesWriteDecision = { allow: true } | { allow: false; reason: SalesWriteBlock };

export function runtimeProjectId(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.GCLOUD_PROJECT?.trim();
  if (named) return named;
  if (!env.FIREBASE_CONFIG) return '';
  try {
    const cfg = JSON.parse(env.FIREBASE_CONFIG) as { projectId?: string };
    return cfg.projectId?.trim() || '';
  } catch {
    return '';
  }
}

export function isProductionTestEmail(email: string): boolean {
  return TEST_EMAIL.test(email.trim());
}

type ParsedHeader =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'origin'; origin: string; host: string };

/** Parses a browser header into its origin. Blank is absent. A bad URL stays invalid. */
function parseHeader(value: string | null | undefined): ParsedHeader {
  if (value == null || value.trim() === '') return { kind: 'absent' };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { kind: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'invalid' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { kind: 'invalid' };
  return { kind: 'origin', origin: url.origin, host };
}

function headerBlock(header: ParsedHeader): SalesWriteBlock | null {
  if (header.kind === 'absent') return null;
  if (header.kind === 'invalid') return 'unapproved-origin';
  if ((STAGING_SALES_HOSTS as readonly string[]).includes(header.host)) return 'staging-origin';
  if (header.origin !== PRODUCTION_MARKETING_ORIGIN) return 'unapproved-origin';
  return null;
}

export function websiteSalesWriteDecision(input: {
  projectId: string;
  origin: string | null;
  referer: string | null;
  email: string;
  emulator?: boolean;
}): SalesWriteDecision {
  const projectId = input.projectId.trim().toLowerCase();
  if (!projectId) return input.emulator ? { allow: true } : { allow: false, reason: 'unknown-project' };
  if (projectId !== PRODUCTION_SALES_PROJECT) return { allow: true };
  const origin = parseHeader(input.origin);
  const referer = parseHeader(input.referer);
  const originBlock = headerBlock(origin);
  if (originBlock) return { allow: false, reason: originBlock };
  if (origin.kind === 'absent') {
    const refererBlock = headerBlock(referer);
    if (refererBlock) return { allow: false, reason: refererBlock };
    if (referer.kind !== 'origin') return { allow: false, reason: 'missing-browser-host' };
  } else if (referer.kind !== 'absent') {
    const refererBlock = headerBlock(referer);
    if (refererBlock) return { allow: false, reason: refererBlock };
  }
  if (isProductionTestEmail(input.email)) return { allow: false, reason: 'test-identity' };
  return { allow: true };
}

/** Runs `effect` only after the production guard allows it. A block skips Auth and Firestore work. */
export function runIfWebsiteSalesAllowed<T>(
  input: {
    projectId: string;
    origin: string | null;
    referer: string | null;
    email: string;
    emulator?: boolean;
  },
  effect: () => T,
): T {
  const decision = websiteSalesWriteDecision(input);
  if (!decision.allow) {
    const error = new Error('error.fn.productionSalesBlocked');
    (error as Error & { reason: SalesWriteBlock }).reason = decision.reason;
    throw error;
  }
  return effect();
}
