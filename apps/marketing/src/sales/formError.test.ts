import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverSalesForm } from './formError';

const secret = 'customer@secret.example';
const stack = `Error: firestore write failed for ${secret}\n    at submitContact (functions/src/sales.ts:234:11)`;

describe('marketing sales forms recover from an unexpected server error', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('shows a generic message and keeps the lead and quote values for retry', () => {
    const lead = {
      name: 'Synthetic Lead',
      business: 'Synthetic Shop',
      email: secret,
      phone: '00000000',
      note: 'private-note-token',
    };
    const quote = {
      name: 'Synthetic Quote',
      company: 'Synthetic Quote Shop',
      email: secret,
      phone: '00000001',
      businessType: 'general-retail',
      branches: 1,
      users: 2,
      posDevices: 1,
    };

    const failedLead = recoverSalesForm(
      { values: lead, error: '', busy: true, completed: false },
      new Error('error.unexpected'),
    );
    expect(failedLead.values).toBe(lead);
    expect(failedLead.busy).toBe(false);
    expect(failedLead.completed).toBe(false);
    expect(failedLead.error).toBe('We could not send this right now. Please try again.');
    expect(failedLead.error).not.toContain(secret);
    expect(failedLead.error).not.toContain('sales.ts');

    const edited = { ...quote, phone: '00000002' };
    const failedQuote = recoverSalesForm(
      { values: edited, error: '', busy: true, completed: false },
      new Error(stack),
    );
    expect(failedQuote.values).toEqual(edited);
    expect(failedQuote.busy).toBe(false);
    expect(failedQuote.completed).toBe(false);
    expect(JSON.stringify(failedQuote)).not.toContain('firestore write failed');
    expect(JSON.stringify(failedQuote)).not.toContain('submitContact');
    expect(failedQuote.error).toBe('We could not send this right now. Please try again.');
  });

  it('maps a leaked internal callable body to the same retryable message', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-zelvero');
    vi.stubEnv('VITE_FIREBASE_FUNCTIONS_REGION', 'europe-west1');
    vi.resetModules();
    const fetchMock = vi.fn(async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
      ok: false,
      json: async () => ({
        error: {
          status: 'INTERNAL',
          message: stack,
          details: {
            key: 'error.unexpected',
            params: {},
            stack,
            email: secret,
          },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    const form = await import('./formError');
    const lead = { name: 'Synthetic Lead', email: secret, phone: '00000000' };

    const leaked = client.callSales('submitWebsiteLead', { source: 'contact', email: secret });
    await expect(leaked).rejects.toThrow('error.unexpected');
    const leakedError = await leaked.catch((err: unknown) => err);
    const recovered = form.recoverSalesForm({ values: lead, error: '', busy: true, completed: false }, leakedError);
    expect(recovered.error).toBe('We could not send this right now. Please try again.');
    expect(recovered.values).toBe(lead);
    expect(recovered.busy).toBe(false);
    expect(JSON.stringify({ shown: recovered.error, thrown: leakedError instanceof Error ? leakedError.message : leakedError })).not.toContain(secret);
    expect(recovered.error).not.toContain('sales.ts');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { status: 'INTERNAL', message: stack } }),
    });
    const raw = client.callSales('submitWebsiteLead', { source: 'quote', email: secret });
    await expect(raw).rejects.toThrow();
    const rawError = await raw.catch((err: unknown) => err);
    const recoveredRaw = form.recoverSalesForm({ values: lead, error: '', busy: true, completed: false }, rawError);
    expect(recoveredRaw.error).toBe('We could not send this right now. Please try again.');
    expect(recoveredRaw.values).toEqual(lead);
    expect(recoveredRaw.busy).toBe(false);
    expect(recoveredRaw.error).not.toContain(secret);
    expect(recoveredRaw.error).not.toContain('sales.ts');
  });
});