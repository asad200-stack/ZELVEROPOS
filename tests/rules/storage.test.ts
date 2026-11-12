import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { deleteObject, getBytes, listAll, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { claims, createEnv, DAY, OTHER, T } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore() as unknown as Firestore;
    const rows: Array<[string, string, boolean]> = [
      [T, T, true],
      ['cashier', T, true],
      ['editor', T, true],
      ['x', OTHER, true],
      ['dead', T, false],
      ['stale', T, false],
    ];
    for (const [uid, tenantId, isActive] of rows) {
      await setDoc(doc(fs, `users/${uid}`), { uid, tenantId, isActive, role: uid === T ? 'owner' : 'subUser' });
    }
  });
});
afterAll(async () => {
  await env.cleanup();
});

const storageFor = (uid: string, o: Parameters<typeof claims>[0] = {}) =>
  env.authenticatedContext(uid, claims(o)).storage() as unknown as FirebaseStorage;

const image = (bytes: number) => new Uint8Array(bytes);

describe('storage', () => {
  it('owners upload product images and logos', async () => {
    const s = storageFor(T);
    await assertSucceeds(uploadBytes(ref(s, `tenants/${T}/products/a.jpg`), image(1024), { contentType: 'image/jpeg' }));
    await assertSucceeds(uploadBytes(ref(s, `tenants/${T}/logo/logo.jpg`), image(1024), { contentType: 'image/jpeg' }));
  });

  it('rejects other tenants, non-images and large files', async () => {
    await assertFails(
      uploadBytes(ref(storageFor('x', { tenantId: OTHER }), `tenants/${T}/products/a.jpg`), image(10), { contentType: 'image/jpeg' }),
    );
    await assertFails(uploadBytes(ref(storageFor(T), `tenants/${T}/products/a.txt`), image(10), { contentType: 'text/plain' }));
    await assertFails(
      uploadBytes(ref(storageFor(T), `tenants/${T}/products/big.jpg`), image(2 * 1024 * 1024 + 1), { contentType: 'image/jpeg' }),
    );
  });

  it('cashiers cannot upload images', async () => {
    const s = storageFor('cashier', { role: 'subUser', perms: { canSell: true } });
    await assertFails(uploadBytes(ref(s, `tenants/${T}/products/a.jpg`), image(10), { contentType: 'image/jpeg' }));
  });

  it('unauthenticated callers cannot list or read objects', async () => {
    const s = env.unauthenticatedContext().storage() as unknown as FirebaseStorage;
    await assertFails(listAll(ref(s, `tenants/${T}/products`)));
    await assertFails(getBytes(ref(s, `tenants/${T}/products/a.jpg`)));
  });

  it('a token that is still active cannot read after the profile is deactivated', async () => {
    const owner = storageFor(T);
    await assertSucceeds(uploadBytes(ref(owner, `tenants/${T}/products/stale.webp`), image(32), { contentType: 'image/webp' }));
    const stale = storageFor('stale', { role: 'subUser', perms: { canSell: true, canViewProducts: true } });
    await assertFails(getBytes(ref(stale, `tenants/${T}/products/stale.webp`)));
  });

  it('expired subscriptions cannot delete images', async () => {
    const owner = storageFor(T);
    await assertSucceeds(uploadBytes(ref(owner, `tenants/${T}/products/keep.jpg`), image(32), { contentType: 'image/jpeg' }));
    await assertSucceeds(uploadBytes(ref(owner, `tenants/${T}/logo/keep.jpg`), image(32), { contentType: 'image/jpeg' }));
    await assertSucceeds(deleteObject(ref(owner, `tenants/${T}/products/keep.jpg`)));
    const expired = storageFor(T, { subUntil: Date.now() - DAY });
    await assertFails(deleteObject(ref(expired, `tenants/${T}/logo/keep.jpg`)));
    const cashier = storageFor('cashier', { role: 'subUser', perms: { canSell: true } });
    await assertFails(deleteObject(ref(cashier, `tenants/${T}/logo/keep.jpg`)));
  });

  it('inactive tokens and other tenants cannot read product images', async () => {
    const owner = storageFor(T);
    await assertSucceeds(uploadBytes(ref(owner, `tenants/${T}/products/ok.webp`), image(32), { contentType: 'image/webp' }));
    await assertFails(getBytes(ref(storageFor('x', { tenantId: OTHER }), `tenants/${T}/products/ok.webp`)));
    await assertFails(getBytes(ref(storageFor('dead', { active: false }), `tenants/${T}/products/ok.webp`)));
  });
});
