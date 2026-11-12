import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sales = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../functions/src/sales.ts'), 'utf8');

describe('trial lifecycle schedule', () => {
  it('runs the shared lifecycle every day at 03:00 in Asia/Beirut', () => {
    const start = sales.indexOf('export const tickTrialLifecycle');
    const body = sales.slice(start, sales.indexOf('export const adminListLeads'));
    expect(body).toContain("schedule: 'every day 03:00'");
    expect(body).toContain("timeZone: 'Asia/Beirut'");
    expect(body).toContain('await runTrialLifecycle(Date.now())');
    expect(body).not.toContain('auth.deleteUser');
    expect(body).not.toContain('subscriptions/');
  });
});
