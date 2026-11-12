import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';
import { precacheList } from '../src/sw/policy.ts';

const WORKER_SOURCES = ['src/sw/worker/sw.ts', 'src/sw/policy.ts'];

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)));
}

/**
 * After the app build, compiles src/sw/worker/sw.ts into dist/sw.js with the exact list of files
 * the build produced (the complete app shell) and a version derived from their contents, so each
 * release installs into a new cache and an unchanged build does not trigger an update.
 */
export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'zelvero-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const base = String(config.base || '/').replace(/\/+$/, '') || '';
      const relative = await listFiles(outDir);
      const files = precacheList(relative, base);
      if (!files.includes(`${base}/index.html`) && !files.includes('/index.html')) {
        throw new Error('[sw] index.html missing from the build output');
      }
      // The worker's own code is part of the version: a new worker must never install into the cache
      // the running one is serving from (a failed install deletes its cache).
      const hash = createHash('sha256').update(process.env.ZELVERO_BUILD_TAG ?? '');
      for (const src of WORKER_SOURCES) hash.update(await readFile(resolve(config.root, src)));
      for (const rel of relative) {
        const url = precacheList([rel], base)[0];
        if (!url) continue;
        hash.update(url).update(await readFile(join(outDir, rel)));
      }
      const version = hash.digest('hex').slice(0, 16);

      await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __SW_VERSION__: JSON.stringify(version),
          __SW_PRECACHE__: JSON.stringify(files),
          __SW_ISOLATED__: JSON.stringify(base !== '' && base !== '/'),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: 'es2022',
          minify: true,
          lib: { entry: resolve(config.root, WORKER_SOURCES[0]), formats: ['iife'], name: 'zelveroServiceWorker', fileName: () => 'sw.js' },
        },
      });
      config.logger.info(`[sw] dist/sw.js: ${files.length} app-shell files, version ${version}`);
    },
  };
}
