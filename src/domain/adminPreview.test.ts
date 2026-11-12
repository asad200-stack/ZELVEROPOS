import { describe, expect, it } from 'vitest';
import { adminPreviewDecision, isAdminPreviewBuild } from './adminPreview';

describe('admin preview access', () => {
  it('recognizes only the explicit preview build flag', () => {
    expect(isAdminPreviewBuild({ VITE_ADMIN_PREVIEW: 'true' })).toBe(true);
    expect(isAdminPreviewBuild({})).toBe(false);
  });

  it('opens the preview only for a ready Super Admin on the internal demo store', () => {
    expect(adminPreviewDecision({ enabled: true, status: 'ready', isSuperAdmin: true, isInternalDemo: true })).toBe('allow');
  });

  it('refuses customer owners and a Super Admin attached to a customer store', () => {
    expect(adminPreviewDecision({ enabled: true, status: 'ready', isSuperAdmin: false, isInternalDemo: false })).toBe('denied');
    expect(adminPreviewDecision({ enabled: true, status: 'ready', isSuperAdmin: true, isInternalDemo: false })).toBe('denied');
    expect(adminPreviewDecision({ enabled: true, status: 'inactive', isSuperAdmin: true, isInternalDemo: false })).toBe('denied');
  });

  it('leaves the normal customer build unrestricted', () => {
    expect(adminPreviewDecision({ enabled: false, status: 'ready', isSuperAdmin: false, isInternalDemo: false })).toBe('allow');
  });
});
