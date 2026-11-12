import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');

const MARKETING_SOURCES = [
  'apps/marketing/src/components/LeadCapture.tsx',
  'apps/marketing/src/components/QuoteWizard.tsx',
  'apps/marketing/src/pages/SimplePages.tsx',
];

function quoted(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function leadSources(): string[] {
  const text = readFileSync(join(repo, 'functions/src/salesModel.ts'), 'utf8');
  const match = text.match(/export const LEAD_SOURCES = \[([^\]]*)\]/);
  if (!match) throw new Error('LEAD_SOURCES missing from functions/src/salesModel.ts');
  return quoted(match[1]);
}

/** Sources the marketing site can put on submitWebsiteLead. Reads the call sites; does not change them. */
function marketingLeadSources(): string[] {
  const found = new Set<string>();
  for (const rel of MARKETING_SOURCES) {
    const text = readFileSync(join(repo, rel), 'utf8');
    for (const match of text.matchAll(/source:\s*((?:'[^']+'\s*\|\s*)+'[^']+')/g)) {
      for (const value of quoted(match[1])) found.add(value);
    }
    for (const match of text.matchAll(/source:\s*'([^']+)'/g)) found.add(match[1]);
    for (const match of text.matchAll(/source="([^"]+)"/g)) found.add(match[1]);
  }
  return [...found].sort();
}

describe('marketing lead sources stay compatible with the sales model', () => {
  it('only names sources LEAD_SOURCES defines', () => {
    const sent = marketingLeadSources();
    expect(sent).toEqual(['AI', 'contact', 'demo_request', 'partner_referral', 'quote']);
    const allowed = new Set(leadSources());
    expect(sent.filter((source) => !allowed.has(source))).toEqual([]);
  });
});
