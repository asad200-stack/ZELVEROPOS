import { describe, expect, it } from 'vitest';
import { escapeHtml, safeUrl } from './html';

describe('HTML escaping', () => {
  it('neutralizes stored XSS payloads used in names, notes and receipts', () => {
    const payload = `<img src=x onerror="alert(1)">&"'`;
    const out = escapeHtml(payload);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;img');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
    expect(out).toContain('&#39;');
  });

  it('rejects javascript: and other non-image URLs for receipt logos', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('https://firebasestorage.googleapis.com/v0/b/x/o/logo.png')).toContain('https://');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });
});
