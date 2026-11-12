import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

/** Same per-file transform as functions/scripts/copy-shared.mjs. This check does not run that script. */
function copyTrialSource(source: string): string {
  const body = source
    .replace(/^\uFEFF/, '')
    .replace(/from '@\/types\/models'/g, "from './models.js'")
    .replace(/from '@\/constants\/permissions'/g, "from './permissions.js'")
    .replace(/from '\.\/([\w-]+)'/g, "from './$1.js'");
  return `// GENERATED from src/domain/trial.ts by functions/scripts/copy-shared.mjs. Do not edit.\n${body}`;
}

function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

describe('shared trial domain copy', () => {
  it('matches src/domain/trial.ts after the copy transform', () => {
    const script = readFileSync(resolve(root, 'functions/scripts/copy-shared.mjs'), 'utf8');
    expect(script).toContain("'src/domain/trial.ts': 'trial.ts'");
    expect(script).toContain('// GENERATED from ${from} by functions/scripts/copy-shared.mjs. Do not edit.');
    expect(script).toContain("from './models.js'");
    expect(script).toContain("from './permissions.js'");
    expect(script).toContain("from './$1.js'");

    const source = readFileSync(resolve(root, 'src/domain/trial.ts'), 'utf8');
    const generated = readFileSync(resolve(root, 'functions/src/shared/trial.ts'), 'utf8');
    const expected = copyTrialSource(source);
    expect(normalize(generated)).toBe(normalize(expected));
    expect(normalize(generated)).not.toContain("from '@/");
  });
});
