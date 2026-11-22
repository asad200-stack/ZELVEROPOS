import { describe, expect, it } from 'vitest';
import { storagePathFromUrl } from '@/utils/storagePath';

describe('storagePathFromUrl', () => {
  it('reads the object path from a download URL', () => {
    expect(
      storagePathFromUrl('https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/tenants%2Ft1%2Fproducts%2Fp1-cutout-123.webp?alt=media&token=abc'),
    ).toBe('tenants/t1/products/p1-cutout-123.webp');
    expect(storagePathFromUrl('http://127.0.0.1:5180/v0/b/demo/o/tenants%2Ft1%2Flogo%2Fstore-hero-1.webp?alt=media')).toBe('tenants/t1/logo/store-hero-1.webp');
  });

  it('returns null for other links', () => {
    expect(storagePathFromUrl('https://example.com/a.jpg')).toBeNull();
    expect(storagePathFromUrl('https://x/o/%E0%A4%A?alt=media')).toBeNull();
  });
});
