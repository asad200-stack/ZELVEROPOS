import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FirebaseConfigError, resolveFirebaseConfigFromEnv } from '@/firebase/config';
import { shouldRegisterServiceWorker } from '@/app/serviceWorker';
import { previewDeployRefusal } from '../../../scripts/superadmin-preview.mjs';
import { isSuperAdminPreviewChannel } from '@/firebase/superadminPreview';
import { isCanonicalPosUi, POS_UI_ID } from './posUi';

function productTileFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules') continue;
      productTileFiles(path, root, out);
    } else if (name.endsWith('.tsx') && readFileSync(path, 'utf8').includes('className="product-tile"')) {
      out.push(path.slice(root.length + 1).replaceAll('\\', '/'));
    }
  }
  return out;
}

describe('canonical POS product card', () => {
  it('renders only the canonical tile', () => {
    const root = join(import.meta.dirname, '../../..');
    const files = productTileFiles(join(root, 'src'), root);
    expect(files).toEqual(['src/features/pos/ProductTile.tsx']);
    const tile = readFileSync(join(root, 'src/features/pos/ProductTile.tsx'), 'utf8');
    expect(tile).toContain('data-pos-ui={POS_UI_ID}');
    expect(tile).not.toContain('pos-card');
    expect(isCanonicalPosUi(POS_UI_ID)).toBe(true);
    const picker = readFileSync(join(root, 'src/features/pos/ProductPicker.tsx'), 'utf8');
    expect(picker).toContain('<ProductTile');
    expect(picker).not.toContain('className="product-tile"');
    const layout = readFileSync(join(root, 'src/layouts/AppLayout.tsx'), 'utf8');
    expect(layout).toContain('data-testid="preview-banner"');
    expect(layout).toContain("VITE_APP_CHANNEL === 'preview'");
  });

  it('does not register a service worker for preview, and never clears stored sales', () => {
    expect(shouldRegisterServiceWorker({ PROD: true, VITE_APP_CHANNEL: 'preview' })).toBe(false);
    expect(shouldRegisterServiceWorker({ PROD: true })).toBe(true);
    expect(shouldRegisterServiceWorker({ PROD: false })).toBe(false);
    const worker = readFileSync(join(import.meta.dirname, '../../app/serviceWorker.ts'), 'utf8');
    expect(worker).not.toContain('indexedDB.deleteDatabase');
    const notice = readFileSync(join(import.meta.dirname, '../../app/UpdateNotice.tsx'), 'utf8');
    expect(notice).toContain('Never reloads on its own');
    expect(notice).toContain("notify('warning'");
    expect(notice).not.toContain('confirm({');
    expect(notice).not.toContain('indexedDB.deleteDatabase');
  });

  it('keeps the retired separate-project preview out of the app', () => {
    expect(isSuperAdminPreviewChannel('superadmin-preview')).toBe(true);
    expect(isSuperAdminPreviewChannel('preview')).toBe(false);
    expect(previewDeployRefusal('zelvoropos', true)).toMatch(/Refusing/);
    expect(previewDeployRefusal('zelvoropos-stage', true)).toMatch(/Refusing/);
    expect(previewDeployRefusal('zelvoropos-preview', false)).toMatch(/not approved/);
    expect(previewDeployRefusal('zelvoropos-preview', true)).toBeNull();
  });

  it('refuses to point the preview channel at production', () => {
    expect(() =>
      resolveFirebaseConfigFromEnv({
        VITE_APP_CHANNEL: 'preview',
        VITE_USE_FIREBASE_EMULATORS: 'false',
        VITE_FIREBASE_API_KEY: 'prod-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
        VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos.appspot.com',
        VITE_FIREBASE_MESSAGING_SENDER_ID: '111',
        VITE_FIREBASE_APP_ID: '1:111:web:abc',
        VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
      }),
    ).toThrow(FirebaseConfigError);
  });

  it('refuses to point the online Super Admin preview at production or staging', () => {
    const base = {
      VITE_APP_CHANNEL: 'superadmin-preview',
      VITE_USE_FIREBASE_EMULATORS: 'false',
      VITE_FIREBASE_API_KEY: 'preview-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos-preview.firebaseapp.com',
      VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos-preview.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '222',
      VITE_FIREBASE_APP_ID: '1:222:web:abc',
    };
    expect(() =>
      resolveFirebaseConfigFromEnv({
        ...base,
        VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
        VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos.firebaseapp.com',
        VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos.appspot.com',
        VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
      }),
    ).toThrow(FirebaseConfigError);
    expect(() =>
      resolveFirebaseConfigFromEnv({
        ...base,
        VITE_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
        VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos-stage.firebaseapp.com',
        VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos-stage.appspot.com',
        VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
      }),
    ).toThrow(FirebaseConfigError);
    expect(() =>
      resolveFirebaseConfigFromEnv({
        ...base,
        VITE_FIREBASE_PROJECT_ID: 'zelvoropos-preview',
        VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos-preview',
      }),
    ).toThrow(FirebaseConfigError);
  });
});
