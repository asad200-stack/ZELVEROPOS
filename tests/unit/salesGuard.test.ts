import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { STAGING_SALES_HOSTS, runIfWebsiteSalesAllowed, runtimeProjectId, websiteSalesWriteDecision } from '../../functions/src/salesGuard';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');

function blocked(input: { projectId?: string; origin?: string | null; referer?: string | null; email?: string; emulator?: boolean }) {
  return websiteSalesWriteDecision({
    projectId: input.projectId ?? 'zelvoropos',
    origin: input.origin ?? null,
    referer: input.referer ?? null,
    email: input.email ?? 'owner@shop.com',
    emulator: input.emulator,
  });
}

describe('production website sales guard', () => {
  it('reads the project id from the server environment only', () => {
    expect(runtimeProjectId({ GCLOUD_PROJECT: 'zelvoropos', FIREBASE_CONFIG: JSON.stringify({ projectId: 'other' }) })).toBe('zelvoropos');
    expect(runtimeProjectId({ FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-zelvero' }) })).toBe('demo-zelvero');
    expect(runtimeProjectId({})).toBe('');
  });

  it('blocks isolated staging hosts, localhost, and test identities before any Auth or Firestore effect', () => {
    const createUser = vi.fn();
    const writeRecords = vi.fn();
    const cases = [
      blocked({ origin: 'https://zelvoropos-stage-web.web.app', email: 'owner@shop.com' }),
      blocked({ referer: 'https://zelvoropos-staging.web.app/quote', email: 'owner@shop.com' }),
      blocked({ origin: 'http://localhost:5180', email: 'owner@shop.com' }),
      blocked({ origin: 'https://zelvero-web-staging.web.app', email: 'cashier@zelvero.test' }),
      blocked({ origin: 'https://zelvoropos.web.app', email: 'cashier@zelvero.test' }),
      blocked({ projectId: '' }),
    ];
    for (const decision of cases) {
      expect(decision.allow).toBe(false);
      expect(() => runIfWebsiteSalesAllowed(
        { projectId: 'zelvoropos', origin: 'https://zelvoropos-stage.web.app', referer: null, email: 'owner@shop.com' },
        () => {
          createUser();
          writeRecords();
        },
      )).toThrow('error.fn.productionSalesBlocked');
    }
    expect(createUser).not.toHaveBeenCalled();
    expect(writeRecords).not.toHaveBeenCalled();
  });

  it('accepts only the exact customer Marketing origin', () => {
    const writeRecords = vi.fn(() => 'lead');
    expect(blocked({ origin: 'https://zelvero-web-staging.web.app', email: 'owner@shop.com' })).toEqual({ allow: true });
    expect(blocked({ origin: 'https://zelvero-web-staging.web.app/pricing', referer: 'https://zelvero-web-staging.web.app/pricing' })).toEqual({ allow: true });
    expect(blocked({ referer: 'https://zelvero-web-staging.web.app/' })).toEqual({ allow: true });
    const result = runIfWebsiteSalesAllowed(
      { projectId: 'zelvoropos', origin: 'https://zelvero-web-staging.web.app', referer: null, email: 'owner@shop.com' },
      () => {
        writeRecords();
        return 'stored';
      },
    );
    expect(result).toBe('stored');
    expect(writeRecords).toHaveBeenCalledOnce();
  });

  it('refuses a production call with no parseable browser host', () => {
    for (const decision of [blocked({}), blocked({ origin: null, referer: null }), blocked({ origin: '   ', referer: '' })]) {
      expect(decision).toEqual({ allow: false, reason: 'missing-browser-host' });
    }
    expect(blocked({ origin: 'not a url', referer: '' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'staging', referer: 'also-not-a-url' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'not a url', referer: 'https://zelvero-web-staging.web.app/quote' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(() => runIfWebsiteSalesAllowed(
      { projectId: 'zelvoropos', origin: null, referer: null, email: 'owner@shop.com' },
      () => 'stored',
    )).toThrow('error.fn.productionSalesBlocked');
  });

  it('blocks every known staging host on production, including the dedicated staging sites', () => {
    const originFor = (host: string) => {
      if (host === '::1') return 'http://[::1]';
      if (host === 'localhost' || host === '127.0.0.1') return `http://${host}:5180`;
      return `https://${host}`;
    };
    for (const host of STAGING_SALES_HOSTS) {
      const origin = originFor(host);
      expect(blocked({ origin, referer: 'https://zelvoropos.web.app' }).allow).toBe(false);
      expect(blocked({ origin: 'https://zelvoropos.web.app', referer: `${origin}/quote` }).allow).toBe(false);
    }
    expect(blocked({ origin: 'https://zelvoropos-stage.web.app' })).toEqual({ allow: false, reason: 'staging-origin' });
    expect(blocked({ origin: 'https://zelvoropos-stage-web.web.app' })).toEqual({ allow: false, reason: 'staging-origin' });
    expect(blocked({ origin: 'https://zelvoropos-stage.web.app.evil.example' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'https://zelvero-web-staging.web.app.evil.example' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'https://evil.example', email: 'owner@shop.com' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'https://zelvoropos.web.app' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'https://zelvero-web-staging.web.app:8443' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'http://zelvero-web-staging.web.app' })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({ origin: 'https://zelvero-web-staging.firebaseapp.com' })).toEqual({ allow: false, reason: 'staging-origin' });
    expect(blocked({
      origin: 'https://zelvoropos.web.app',
      referer: 'https://zelvero-web-staging.web.app',
    })).toEqual({ allow: false, reason: 'unapproved-origin' });
    expect(blocked({
      origin: 'https://zelvero-web-staging.web.app',
      referer: 'https://evil.example/path',
    })).toEqual({ allow: false, reason: 'unapproved-origin' });
  });

  it('does not let request data select the project', () => {
    expect(blocked({ projectId: 'zelvoropos', origin: 'https://zelvoropos-stage-web.web.app' }).allow).toBe(false);
    expect(websiteSalesWriteDecision({
      projectId: 'zelvoropos-stage',
      origin: 'https://zelvoropos-stage-web.web.app',
      referer: null,
      email: 'owner@shop.com',
    })).toEqual({ allow: true });
    const source = readFileSync(join(repo, 'functions/src/sales.ts'), 'utf8');
    const guard = source.slice(source.indexOf('function refuseProductionTestWrite'), source.indexOf('function clientIp'));
    expect(guard).toContain('runtimeProjectId()');
    expect(guard).not.toMatch(/data\.(projectId|tenantId|environment|project)/);
  });

  it('keeps website sales mode at staging and does not pre-verify trial mailboxes', () => {
    const config = readFileSync(join(repo, 'functions/src/config.ts'), 'utf8');
    expect(config).toContain("defineString('WEBSITE_SALES_MODE'");
    expect(config).toMatch(/WEBSITE_SALES_MODE[\s\S]*default:\s*'staging'/);
    expect(config).not.toMatch(/WEBSITE_SALES_MODE[\s\S]*default:\s*'on'/);
    const source = readFileSync(join(repo, 'functions/src/sales.ts'), 'utf8');
    const trial = source.slice(source.indexOf('export const provisionWebsiteTrial'), source.indexOf('export async function runTrialLifecycle'));
    const create = trial.slice(trial.indexOf('auth.createUser'), trial.indexOf('platformProvisionState'));
    expect(create).toContain('emailVerified: false');
    expect(create).not.toContain('emailVerified: true');
  });

  it('does not apply the production block on the emulator or the staging project', () => {
    expect(blocked({ projectId: 'demo-zelvero', origin: 'https://zelvero-web-staging.web.app', email: 'a@zelvero.test' })).toEqual({ allow: true });
    expect(blocked({ projectId: 'zelvoropos-stage', origin: null, referer: null, email: 'a@zelvero.test' })).toEqual({ allow: true });
    expect(blocked({ projectId: 'zelvoropos-stage', origin: 'https://zelvoropos-stage.web.app', email: 'owner@shop.com' })).toEqual({ allow: true });
  });

  it('calls the guard before rate limits, lead writes, and Auth user creation', () => {
    const source = readFileSync(join(repo, 'functions/src/sales.ts'), 'utf8');
    const lead = source.slice(source.indexOf('export const submitWebsiteLead'), source.indexOf('async function submitContact'));
    const trial = source.slice(source.indexOf('export const provisionWebsiteTrial'), source.indexOf('export async function runTrialLifecycle'));
    expect(lead.indexOf('refuseProductionTestWrite')).toBeGreaterThan(0);
    expect(lead.indexOf('readPublicLead')).toBeGreaterThan(lead.indexOf('salesMode'));
    expect(lead).not.toContain('.parse((request.data');
    expect(lead.indexOf('refuseProductionTestWrite')).toBeLessThan(lead.indexOf('salesMode'));
    expect(lead.indexOf('refuseProductionTestWrite')).toBeLessThan(lead.indexOf('rateLimit'));
    expect(trial.indexOf('refuseProductionTestWrite')).toBeLessThan(trial.indexOf('salesMode'));
    expect(trial.indexOf('refuseProductionTestWrite')).toBeLessThan(trial.indexOf('rateLimit'));
    expect(trial.indexOf('refuseProductionTestWrite')).toBeLessThan(trial.indexOf('auth.createUser'));
  });
});
