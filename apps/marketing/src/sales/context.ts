const KEY = 'zelvero.web.aiContext';

export interface SalesContext {
  businessType?: string;
  interestedFeatures?: string[];
}

export function writeSalesContext(ctx: SalesContext): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* private mode */
  }
}

export function readSalesContext(): SalesContext {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return fromQuery(window.location.search);
    return { ...JSON.parse(raw), ...fromQuery(window.location.search) };
  } catch {
    return fromQuery(typeof window !== 'undefined' ? window.location.search : '');
  }
}

function fromQuery(search: string): SalesContext {
  const q = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const businessType = q.get('businessType') || undefined;
  const features = q.get('features');
  return {
    businessType,
    interestedFeatures: features ? features.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };
}

export function withContext(path: string, ctx: SalesContext): string {
  const [base, hash] = path.split('#');
  const url = new URL(base, 'https://zelvero.local');
  if (ctx.businessType) url.searchParams.set('businessType', ctx.businessType);
  if (ctx.interestedFeatures?.length) url.searchParams.set('features', ctx.interestedFeatures.join(','));
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}
