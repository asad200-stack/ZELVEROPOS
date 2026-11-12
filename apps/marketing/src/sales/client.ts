const PROJECT = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
const REGION = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1';
const SALES_BACKEND = import.meta.env.VITE_SALES_BACKEND || '';

/**
 * Local Functions emulator only. Production and staging builds drop this body.
 * A demo-* project and the emulator flag are both required, and the host is loopback.
 */
function localEmulatorBase(): string | null {
  if (import.meta.env.MODE === 'production' || import.meta.env.MODE === 'staging') return null;
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'true') return null;
  const project = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '');
  if (!project.startsWith('demo-')) return null;
  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1';
  return `http://127.0.0.1:5001/${project}/${region}`;
}

/**
 * A request is allowed only when the Vite mode, the explicit sales backend, and the project id agree.
 * Matching the production project id is not enough. Staging builds may name only the staging project;
 * the production project literal stays in the branch Vite removes from those bundles.
 */
export function salesTargetError(projectId: string): string | null {
  const id = projectId.trim();
  if (localEmulatorBase() && id.startsWith('demo-')) return null;
  if (import.meta.env.MODE === 'staging') {
    if (SALES_BACKEND !== 'staging' || !id) return 'Sales backend is not configured.';
    if (id !== 'zelvoropos-stage') return 'error.salesProductionBlocked';
    return null;
  }
  if (import.meta.env.MODE === 'production' && SALES_BACKEND === 'production' && id === 'zelvoropos') return null;
  if (id === 'zelvoropos') return 'error.salesProductionBlocked';
  return 'Sales backend is not configured.';
}

export function salesConfigured(): boolean {
  return salesTargetError(PROJECT) === null;
}

export function operationId(kind: string): string {
  try {
    const key = `zelvero.web.op.${kind}`;
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = `${kind}${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `${kind}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function clearOperation(kind: string): void {
  try {
    sessionStorage.removeItem(`zelvero.web.op.${kind}`);
  } catch {
    /* private mode */
  }
}

export function formStartedAt(): number {
  try {
    const key = 'zelvero.web.formStart';
    const existing = Number(sessionStorage.getItem(key) || 0);
    if (existing) return existing;
    const now = Date.now();
    sessionStorage.setItem(key, String(now));
    return now;
  } catch {
    return Date.now() - 1_000;
  }
}

export async function callSales<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const problem = salesTargetError(PROJECT);
  if (problem) throw new Error(problem);
  const payload = {
    ...data,
    clientOperationId: String(data.clientOperationId || operationId(name)),
    formStartedAt: Number(data.formStartedAt || formStartedAt()),
    website: '',
  };
  const emulator = localEmulatorBase();
  const res = await fetch(emulator ? `${emulator}/${name}` : `https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string; status?: string; details?: { key?: string } } };
  if (!res.ok || json.error) {
    const key = json.error?.details?.key || json.error?.message || 'error.unexpected';
    throw new Error(key);
  }
  return json.result as T;
}

export function mapSalesError(err: unknown): string {
  const key = err instanceof Error ? err.message : '';
  if (key === 'error.salesProductionBlocked') return 'This preview cannot send forms to the production project.';
  if (key === 'error.fn.trialNotOpen') return 'Public trial signup is not open yet. Request a demo or a quote.';
  if (key === 'error.fn.trialUnavailable') return 'This email cannot start a new trial.';
  if (key === 'error.fn.salesBackendDisabled') return 'Sales intake is not open yet.';
  if (key === 'error.tooManyRequests') return 'Please wait a moment and try again.';
  if (key === 'error.invalidInput') return 'Please check the form and try again.';
  return 'We could not send this right now. Please try again.';
}

formStartedAt();
