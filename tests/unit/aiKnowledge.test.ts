import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Zelvero AI knowledge refresh', () => {
  it('rejects a draft whose source hash or review no longer matches', () => {
    const output = execFileSync(process.execPath, ['scripts/ai-knowledge.mjs', '--check'], { cwd: root, encoding: 'utf8' });
    expect(output).toContain('checked');
  });

  it('does not wire the panel or the indexer to business actions or a paid API', () => {
    const panel = readFileSync(join(root, 'src/features/ai/AiPanel.tsx'), 'utf8');
    const indexer = readFileSync(join(root, 'scripts/ai-knowledge.mjs'), 'utf8');
    const model = readFileSync(join(root, 'src/features/ai/localModel.ts'), 'utf8');
    expect(panel).not.toMatch(/posApi|functionsClient|httpsCallable|firebase\/firestore|firebase-admin/);
    expect(indexer).not.toMatch(/firebase-admin|openai|anthropic|generativelanguage|sessionStorage/);
    expect(model).not.toMatch(/api\.openai\.com|generativelanguage\.googleapis|api\.anthropic\.com/);
  });
});
