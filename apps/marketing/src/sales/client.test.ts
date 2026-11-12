import { afterEach, describe, expect, it, vi } from 'vitest';
import { callSales, mapSalesError, salesConfigured, salesTargetError } from './client';

function jsonResponse(result: unknown) {
  return { ok: true, json: async () => ({ result }) };
}

describe('marketing sales calls follow the explicit backend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails closed in a test build that has no explicit production backend', () => {
    expect(salesTargetError('zelvoropos')).toBe('error.salesProductionBlocked');
    expect(salesTargetError('')).toBe('Sales backend is not configured.');
    expect(salesTargetError('other-project')).toBe('Sales backend is not configured.');
    expect(salesTargetError('zelvoropos-stage')).toBe('Sales backend is not configured.');
    expect(mapSalesError(new Error('error.salesProductionBlocked'))).toContain('production project');
    expect(salesConfigured()).toBe(false);
  });

  it('does not fetch when this build is aimed at zelvoropos without production configuration', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'zelvoropos');
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    await expect(client.callSales('submitWebsiteLead', { source: 'contact' })).rejects.toThrow('error.salesProductionBlocked');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.salesConfigured()).toBe(false);
  });

  it('does not fetch from the already loaded client when its project is production or unset', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(callSales('provisionWebsiteTrial', {})).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    if (salesConfigured()) throw new Error('salesConfigured() is true; this test bundle can still reach a Firebase project');
  });

  it('submits to production only when mode, backend, and project all agree', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_SALES_BACKEND', 'production');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'zelvoropos');
    vi.stubEnv('VITE_FIREBASE_FUNCTIONS_REGION', 'europe-west1');
    vi.resetModules();
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    expect(client.salesTargetError('zelvoropos')).toBeNull();
    expect(client.salesTargetError('zelvoropos-stage')).toBe('Sales backend is not configured.');
    await client.callSales('submitWebsiteLead', { source: 'contact', clientOperationId: 'leadtest' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://europe-west1-zelvoropos.cloudfunctions.net/submitWebsiteLead');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body) as { data: { source: string; website: string; clientOperationId: string } };
    expect(body.data.source).toBe('contact');
    expect(body.data.website).toBe('');
    expect(body.data.clientOperationId).toBe('leadtest');
  });

  it('submits a staging build only to zelvoropos-stage', async () => {
    vi.stubEnv('MODE', 'staging');
    vi.stubEnv('VITE_SALES_BACKEND', 'staging');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'zelvoropos-stage');
    vi.stubEnv('VITE_FIREBASE_FUNCTIONS_REGION', 'europe-west1');
    vi.resetModules();
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    expect(client.salesTargetError('zelvoropos-stage')).toBeNull();
    expect(client.salesTargetError('zelvoropos')).toBe('error.salesProductionBlocked');
    expect(client.salesTargetError('other-project')).toBe('error.salesProductionBlocked');
    await client.callSales('submitWebsiteLead', { source: 'quote' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://europe-west1-zelvoropos-stage.cloudfunctions.net/submitWebsiteLead');
  });

  it('calls the local emulator only for a demo project outside production and staging', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-zelvero');
    vi.stubEnv('VITE_FIREBASE_FUNCTIONS_REGION', 'europe-west1');
    vi.resetModules();
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    expect(client.salesConfigured()).toBe(true);
    await client.callSales('submitWebsiteLead', { source: 'contact', clientOperationId: 'emulatorop1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('http://127.0.0.1:5001/demo-zelvero/europe-west1/submitWebsiteLead');
    expect(JSON.parse(init.body).data.website).toBe('');

    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_SALES_BACKEND', 'production');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'zelvoropos');
    vi.resetModules();
    const production = await import('./client');
    expect(production.salesTargetError('zelvoropos')).toBeNull();
    expect(production.salesTargetError('demo-zelvero')).toBe('Sales backend is not configured.');

    vi.stubEnv('MODE', 'staging');
    vi.stubEnv('VITE_SALES_BACKEND', 'staging');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-zelvero');
    vi.resetModules();
    const staging = await import('./client');
    expect(staging.salesConfigured()).toBe(false);
  });

  it('rejects contradictory mode, backend, and project combinations before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cases = [
      { MODE: 'staging', VITE_SALES_BACKEND: 'production', VITE_FIREBASE_PROJECT_ID: 'zelvoropos-stage' },
      { MODE: 'production', VITE_SALES_BACKEND: 'staging', VITE_FIREBASE_PROJECT_ID: 'zelvoropos' },
      { MODE: 'production', VITE_SALES_BACKEND: 'production', VITE_FIREBASE_PROJECT_ID: 'other-project' },
      { MODE: 'production', VITE_SALES_BACKEND: '', VITE_FIREBASE_PROJECT_ID: 'zelvoropos' },
      { MODE: 'staging', VITE_SALES_BACKEND: 'staging', VITE_FIREBASE_PROJECT_ID: '' },
    ];
    for (const env of cases) {
      vi.stubEnv('MODE', env.MODE);
      vi.stubEnv('VITE_SALES_BACKEND', env.VITE_SALES_BACKEND);
      vi.stubEnv('VITE_FIREBASE_PROJECT_ID', env.VITE_FIREBASE_PROJECT_ID);
      vi.resetModules();
      const client = await import('./client');
      expect(client.salesConfigured()).toBe(false);
      await expect(client.callSales('provisionWebsiteTrial', {})).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
