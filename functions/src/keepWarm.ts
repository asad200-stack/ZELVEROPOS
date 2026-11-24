import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { REGION, STORE_SITE_ORIGIN } from './config.js';

/** Slug that never exists: the call only wakes the server, it reads no shop. */
const WARM_SLUG = 'zv-keep-warm';

/**
 * Shop websites: a server that had no visitor for ~15 minutes goes to sleep, and the next visitor
 * waited ~3 s more for the page and the products. Every 10 minutes this wakes the two servers a
 * shop page needs (the page itself and the catalogue). Stays within the free allowance
 * (scheduler jobs and calls), no minimum instances are paid for.
 */
export const keepStoresWarm = onSchedule(
  { schedule: 'every 10 minutes', region: REGION, memory: '128MiB', timeoutSeconds: 30, maxInstances: 1, retryCount: 0 },
  async () => {
    const project = process.env.GCLOUD_PROJECT ?? '';
    const catalog = `https://${REGION}-${project}.cloudfunctions.net/publicStoreCatalog`;
    const page = `${STORE_SITE_ORIGIN.value()}/s/${WARM_SLUG}`;
    const results = await Promise.allSettled([
      fetch(catalog, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { slug: WARM_SLUG } }),
        signal: AbortSignal.timeout(20_000),
      }),
      fetch(page, { signal: AbortSignal.timeout(20_000) }),
    ]);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) logger.warn('keepStoresWarm: a wake-up call failed', { failed });
  },
);
