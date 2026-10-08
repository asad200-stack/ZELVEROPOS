import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const components = readFileSync(new URL('../../src/styles/components.css', import.meta.url), 'utf8');
const form = readFileSync(new URL('../../src/components/ui/Form.tsx', import.meta.url), 'utf8');

describe('numeric direction', () => {
  it('types amounts from the left in both languages', () => {
    const rule = components.slice(components.indexOf("input[inputmode='numeric']"));
    expect(rule).toContain('direction: ltr');
    expect(rule).toContain('unicode-bidi: isolate');
    expect(rule).toContain('text-align: left');
    expect(components).toContain('input.input--qty');
    expect(components).toContain('input.qty__input');
  });

  it('sets dir=ltr on shared money and number inputs', () => {
    expect(form).toContain('dir="ltr"');
    expect(form).toContain("inputMode === 'decimal'");
    expect(form).toContain("inputMode === 'numeric'");
  });
});
