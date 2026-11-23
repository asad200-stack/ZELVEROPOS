#!/usr/bin/env node
/**
 * READ-ONLY. Checks that the deployed publicStorePage function serves the store tree's HTML shell
 * (STORE_SHELL_PATH) before /s/** is pointed at it. Exit 0 = safe to switch, 1 = keep the old rewrite.
 */
const VERSION = process.env.STORE_RELEASE_VERSION || '0.9.3';
const url = 'https://europe-west1-zelvoropos.cloudfunctions.net/publicStorePage/s/zz-share-check';
try {
  const res = await fetch(url, { cache: 'no-store' });
  const html = await res.text();
  const ok = res.status === 200 && html.includes(`/app/${VERSION}/assets/`);
  console.log(`share check ${res.status} tree=${html.includes(`/app/${VERSION}/assets/`)} bytes=${html.length}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log('share check failed: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
