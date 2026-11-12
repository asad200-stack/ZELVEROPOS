import { describe, expect, it, vi } from 'vitest';
import { HttpsError, rethrowClientSafe } from '../../functions/src/errors';
import { readPublicLead, salesBody } from '../../functions/src/salesInput';
import { contactSchema, quoteSchema, trialSchema } from '../../functions/src/salesModel';
import { parse } from '../../functions/src/validate';

const started = Date.now() - 5_000;

function assertInvalid(run: () => unknown, secret = ''): void {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  const error = caught as HttpsError;
  expect(error.code).toBe('invalid-argument');
  expect(error.message).toBe('error.invalidInput');
  const rendered = JSON.stringify({ message: error.message, details: error.details });
  expect(rendered).not.toContain('ZodError');
  expect(rendered).not.toContain('stack');
  if (secret) expect(rendered).not.toContain(secret);
}

describe('website sales input errors', () => {
  it('rejects an empty or non-object request as invalid-argument', () => {
    for (const value of [undefined, null, '', 0, []]) {
      assertInvalid(() => salesBody(value));
      assertInvalid(() => readPublicLead(value));
    }
    assertInvalid(() => readPublicLead({}));
  });

  it('rejects a malformed source and a malformed field without echoing the value', () => {
    assertInvalid(() => readPublicLead({ source: 'nope' }));
    assertInvalid(() => readPublicLead({ source: 'trial' }));
    const secret = 'not-an-email';
    assertInvalid(() => parse(contactSchema, {
      source: 'contact',
      name: 'Synthetic',
      businessName: 'Synthetic Shop',
      email: secret,
      phone: '000',
      clientOperationId: 'contactop1',
      formStartedAt: started,
    }), secret);
  });

  it('accepts the marketing lead, quote, and trial payload shapes', () => {
    const lead = {
      source: 'contact',
      name: 'Synthetic Owner',
      businessName: 'Synthetic Shop',
      email: 'owner@example.com',
      phone: '00000000',
      businessType: 'general-retail',
      note: '',
      preferredContact: 'email',
      interestedFeatures: ['POS'],
      referralCode: '',
      clientOperationId: 'contactop1',
      formStartedAt: started,
      website: '',
    };
    expect(readPublicLead(lead).source).toBe('contact');
    expect(parse(contactSchema, readPublicLead(lead).body).email).toBe('owner@example.com');

    const quote = {
      ...lead,
      source: 'quote',
      clientOperationId: 'quoteop001',
      branches: 1,
      users: 2,
      posDevices: 1,
      features: ['POS'],
      specialRequirements: '',
    };
    expect(readPublicLead(quote).source).toBe('quote');
    expect(parse(quoteSchema, readPublicLead(quote).body).branches).toBe(1);

    const trial = {
      ownerName: 'Synthetic Owner',
      name: 'Synthetic Owner',
      businessName: 'Synthetic Shop',
      email: 'owner@zelvero.test',
      phone: '00000000',
      businessType: 'general-retail',
      country: 'LB',
      primaryCurrency: 'USD',
      password: 'synthetic-pass',
      interestedFeatures: [],
      referralCode: '',
      clientOperationId: 'trialop001',
      formStartedAt: started,
      website: '',
    };
    expect(salesBody(trial).ownerName).toBe('Synthetic Owner');
    expect(parse(trialSchema, { ...trial, name: trial.ownerName }).email).toBe('owner@zelvero.test');
  });

  it('converts an unexpected server exception into error.unexpected', async () => {
    const submitted = {
      email: 'customer@secret.example',
      name: 'Secret Owner',
      note: 'private-note-token',
      password: 'synthetic-pass-secret',
    };
    const crash = new Error(`firestore write failed for ${submitted.email}`);
    crash.stack = [
      `Error: firestore write failed for ${submitted.email}`,
      '    at submitContact (functions/src/sales.ts:234:11)',
      `    submitted ${submitted.note}`,
    ].join('\n');
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });

    const leadHandler = async (data: typeof submitted) => {
      try {
        throw Object.assign(crash, { submitted: data });
      } catch (err) {
        rethrowClientSafe(err);
      }
    };

    try {
      await leadHandler(submitted);
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      const error = err as HttpsError;
      expect(error.code).toBe('internal');
      expect(error.message).toBe('error.unexpected');
      const clientPayload = error.toJSON();
      expect(clientPayload).toEqual({
        details: { key: 'error.unexpected', params: {} },
        message: 'error.unexpected',
        status: 'INTERNAL',
      });
      const rendered = JSON.stringify(clientPayload);
      expect(rendered).not.toContain('stack');
      expect(rendered).not.toContain('sales.ts');
      expect(rendered).not.toContain('submitContact');
      expect(rendered).not.toContain('firestore write failed');
      for (const value of Object.values(submitted)) expect(rendered).not.toContain(value);
      expect(JSON.stringify(logged)).toContain(submitted.email);
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves a client-safe validation error unchanged', () => {
    const safe = new HttpsError('invalid-argument', 'error.invalidInput', { key: 'error.invalidInput', params: {} });
    expect(() => rethrowClientSafe(safe)).toThrow(safe);
  });
});
