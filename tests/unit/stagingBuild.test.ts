import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import {
  parseDotEnv,
  productionBundleMarkers,
  stagingBundleProblems,
  stagingEnvPath,
  stagingWebEnvProblems,
} from '../../scripts/staging-build.mjs';

const iso = {
  blocked: { projectIds: ['pos-catch', 'pos-catch-test'] },
  placeholderProjectIds: ['', 'your-new-project-id', 'zelvero-pos-REPLACE-ME'],
  emulatorProjectPrefix: 'demo-',
  productionProjectId: 'zelvoropos',
  stagingProjectId: 'zelvero-staging-example',
};

const posEnv = {
  VITE_FIREBASE_API_KEY: 'staging-api-key-value',
  VITE_FIREBASE_AUTH_DOMAIN: 'zelvero-staging-example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'zelvero-staging-example',
  VITE_FIREBASE_STORAGE_BUCKET: 'zelvero-staging-example.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  VITE_FIREBASE_APP_ID: '1:123456789:web:abc123',
  VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvero-staging-example',
  VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
  VITE_FIREBASE_APPCHECK_SITE_KEY: '',
  VITE_USE_FIREBASE_EMULATORS: 'false',
};

describe('staging env files', () => {
  it('rejects an unconfigured staging project and a production project id', () => {
    const unset = stagingWebEnvProblems({
      kind: 'pos',
      env: { ...posEnv, VITE_FIREBASE_PROJECT_ID: '', VITE_EXPECTED_FIREBASE_PROJECT_ID: '' },
      iso: { ...iso, stagingProjectId: '' },
      fnRegion: 'europe-west1',
    });
    expect(unset.some((problem) => problem.includes('cannot fall back to zelvoropos'))).toBe(true);
    expect(unset.some((problem) => problem.includes('VITE_FIREBASE_PROJECT_ID is missing'))).toBe(true);

    const production = stagingWebEnvProblems({
      kind: 'pos',
      env: {
        ...posEnv,
        VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
        VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos',
        VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos.firebaseapp.com',
        VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos.appspot.com',
      },
      iso: { ...iso, stagingProjectId: 'zelvoropos' },
      fnRegion: 'europe-west1',
    });
    expect(production.some((problem) => problem.includes('different project from production'))).toBe(true);
    expect(production.some((problem) => problem.includes('production project zelvoropos'))).toBe(true);
  });

  it('accepts the zelvoropos-stage project id without treating it as production', () => {
    const env = {
      ...posEnv,
      VITE_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'zelvoropos-stage',
      VITE_FIREBASE_AUTH_DOMAIN: 'zelvoropos-stage.firebaseapp.com',
      VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos-stage.firebasestorage.app',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '698888964825',
      VITE_FIREBASE_APP_ID: '1:698888964825:web:52c767411f5ce2fa37ccc8',
    };
    expect(
      stagingWebEnvProblems({
        kind: 'pos',
        env,
        iso: { ...iso, stagingProjectId: 'zelvoropos-stage', productionHostingSites: ['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging'] },
        fnRegion: 'europe-west1',
      }),
    ).toEqual([]);
  });

  it('accepts a matching staging project and rejects copied production web config', () => {
    expect(stagingWebEnvProblems({ kind: 'pos', env: posEnv, iso, fnRegion: 'europe-west1' })).toEqual([]);
    const copied = stagingWebEnvProblems({
      kind: 'pos',
      env: posEnv,
      iso,
      fnRegion: 'europe-west1',
      productionEnv: { VITE_FIREBASE_API_KEY: posEnv.VITE_FIREBASE_API_KEY },
    });
    expect(copied).toEqual([
      'Staging VITE_FIREBASE_API_KEY matches the production web config. Production values must not be copied into staging.',
    ]);
  });

  it('requires the marketing staging origin to avoid the production POS', () => {
    const missing = stagingWebEnvProblems({
      kind: 'marketing',
      env: { VITE_FIREBASE_PROJECT_ID: 'zelvero-staging-example', VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1' },
      iso,
      fnRegion: 'europe-west1',
    });
    expect(missing.some((problem) => problem.includes('VITE_POS_ORIGIN is missing'))).toBe(true);
    const productionOrigin = stagingWebEnvProblems({
      kind: 'marketing',
      env: {
        VITE_FIREBASE_PROJECT_ID: 'zelvero-staging-example',
        VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
        VITE_POS_ORIGIN: 'https://zelvoropos.web.app',
      },
      iso,
      fnRegion: 'europe-west1',
    });
    expect(productionOrigin.some((problem) => problem.includes('references the production project'))).toBe(true);
    expect(
      stagingWebEnvProblems({
        kind: 'marketing',
        env: {
          VITE_FIREBASE_PROJECT_ID: 'zelvero-staging-example',
          VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
          VITE_POS_ORIGIN: 'https://zelvero-pos-staging-example.web.app',
          VITE_SALES_BACKEND: 'staging',
        },
        iso,
        fnRegion: 'europe-west1',
      }),
    ).toEqual([]);
    const wrongBackend = stagingWebEnvProblems({
      kind: 'marketing',
      env: {
        VITE_FIREBASE_PROJECT_ID: 'zelvero-staging-example',
        VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
        VITE_POS_ORIGIN: 'https://zelvero-pos-staging-example.web.app',
        VITE_SALES_BACKEND: 'production',
      },
      iso,
      fnRegion: 'europe-west1',
    });
    expect(wrongBackend.some((problem) => problem.includes('VITE_SALES_BACKEND must be "staging"'))).toBe(true);
  });

  it('keeps the live staging env on zelvoropos-stage and off production values', () => {
    const productionToken = /(?<![A-Za-z0-9])zelvoropos(?![A-Za-z0-9-])/;
    for (const kind of ['pos', 'marketing'] as const) {
      const text = readFileSync(stagingEnvPath(kind), 'utf8');
      expect(text).not.toMatch(productionToken);
      const staging = parseDotEnv(stagingEnvPath(kind));
      const production = parseDotEnv(join(process.cwd(), '.env.production'));
      const identifiers = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_STORAGE_BUCKET',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_EXPECTED_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_APPCHECK_SITE_KEY',
        'VITE_POS_ORIGIN',
      ];
      for (const key of identifiers) {
        if (!production[key]) continue;
        expect(staging[key] || '').not.toBe(production[key]);
      }
      expect(staging.VITE_FIREBASE_PROJECT_ID).toBe('zelvoropos-stage');
    }
    const marketing = parseDotEnv(stagingEnvPath('marketing'));
    expect(marketing.VITE_POS_ORIGIN).toBe('https://zelvoropos-stage.web.app');
    expect(marketing.VITE_FIREBASE_APP_ID || '').toBe('');
    expect(parseDotEnv(stagingEnvPath('pos')).VITE_FIREBASE_APP_ID).toBe('1:698888964825:web:52c767411f5ce2fa37ccc8');
  });
});

describe('staging bundle audit', () => {
  it('rejects production project, functions hostname, and storage bucket references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zelvero-staging-bundle-'));
    const markers = productionBundleMarkers({
      productionProjectId: 'zelvoropos',
      functionsRegion: 'europe-west1',
      productionEnv: { VITE_FIREBASE_STORAGE_BUCKET: 'zelvoropos.firebasestorage.app' },
    });
    try {
      writeFileSync(join(dir, 'clean.js'), 'const projectId = "zelvoropos-stage";');
      expect(stagingBundleProblems(dir, markers)).toEqual([]);
      writeFileSync(join(dir, 'project.js'), 'projectId:"zelvoropos"');
      expect(stagingBundleProblems(dir, markers).some((problem) => problem.includes('production Firebase project'))).toBe(true);
      writeFileSync(join(dir, 'project.js'), 'ok');
      writeFileSync(join(dir, 'fns.js'), 'https://europe-west1-zelvoropos.cloudfunctions.net/submitWebsiteLead');
      expect(stagingBundleProblems(dir, markers).some((problem) => problem.includes('production Functions hostname'))).toBe(true);
      writeFileSync(join(dir, 'fns.js'), 'ok');
      writeFileSync(join(dir, 'bucket.js'), 'zelvoropos.appspot.com');
      expect(stagingBundleProblems(dir, markers).some((problem) => problem.includes('production Storage bucket'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects production hosts and keeps the dedicated staging hosts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zelvero-staging-hosts-'));
    const markers = productionBundleMarkers({
      productionProjectId: 'zelvoropos',
      functionsRegion: 'europe-west1',
      productionHostingSites: ['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging'],
    });
    try {
      writeFileSync(join(dir, 'stage.js'), 'https://zelvoropos-stage.web.app https://zelvoropos-stage-web.web.app europe-west1-zelvoropos-stage.cloudfunctions.net');
      expect(stagingBundleProblems(dir, markers)).toEqual([]);
      writeFileSync(join(dir, 'old.js'), 'https://zelvoropos-staging.web.app');
      expect(stagingBundleProblems(dir, markers).some((problem) => problem.includes('production Hosting site'))).toBe(true);
      writeFileSync(join(dir, 'old.js'), 'https://zelvero-web-staging.web.app');
      expect(stagingBundleProblems(dir, markers).some((problem) => problem.includes('production Hosting site'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the production build command off the staging path', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toBe('tsc -b && vite build');
    expect(pkg.scripts['build:staging']).toBe('node scripts/staging-build.mjs pos');
    expect(pkg.scripts['web:build:staging']).toBe('node scripts/staging-build.mjs marketing');
    const posConfig = readFileSync(join(process.cwd(), 'src/firebase/config.ts'), 'utf8');
    expect(posConfig).not.toMatch(/(?<![A-Za-z0-9])zelvoropos(?![A-Za-z0-9-])/);
    const marketing = readFileSync(join(process.cwd(), 'apps/marketing/src/sales/client.ts'), 'utf8');
    expect(marketing).toContain("import.meta.env.MODE === 'staging'");
    expect(marketing).toContain("'zelvoropos'");
  });
});

async function bundleSource(entry: string, define: Record<string, string>): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    define,
    build: {
      write: false,
      minify: true,
      lib: { entry, formats: ['es'], fileName: 'bundle' },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((item) => ('output' in item ? item.output : []))
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

describe('staging source does not embed production into a staging bundle', () => {
  const define = {
    'import.meta.env.MODE': '"staging"',
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': '"zelvero-staging-example"',
    'import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION': '"europe-west1"',
    'import.meta.env.VITE_POS_ORIGIN': '"https://zelvero-pos-staging-example.web.app"',
  };

  it('drops the production project from the marketing sales client and POS origin', async () => {
    const sales = await bundleSource('apps/marketing/src/sales/client.ts', define);
    const origin = await bundleSource('apps/marketing/src/constants.ts', define);
    expect(sales).not.toMatch(/(?<![A-Za-z0-9])zelvoropos(?![A-Za-z0-9-])/);
    expect(sales).toContain('zelvero-staging-example');
    expect(sales).toContain('cloudfunctions.net');
    expect(origin).not.toContain('zelvoropos');
    expect(origin).toContain('https://zelvero-pos-staging-example.web.app');
  });

  it('keeps zelvoropos-stage in a staging bundle without the production project token', async () => {
    const sales = await bundleSource('apps/marketing/src/sales/client.ts', {
      'import.meta.env.MODE': '"staging"',
      'import.meta.env.VITE_SALES_BACKEND': '"staging"',
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': '"zelvoropos-stage"',
      'import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION': '"europe-west1"',
    });
    const origin = await bundleSource('apps/marketing/src/constants.ts', {
      'import.meta.env.MODE': '"staging"',
      'import.meta.env.VITE_POS_ORIGIN': '"https://zelvoropos-stage.web.app"',
    });
    const productionToken = /(?<![A-Za-z0-9])zelvoropos(?![A-Za-z0-9-])/;
    expect(sales).toContain('zelvoropos-stage');
    expect(sales).toContain('cloudfunctions.net');
    expect(sales).not.toMatch(productionToken);
    expect(origin).toContain('https://zelvoropos-stage.web.app');
    expect(origin).not.toMatch(productionToken);
  });

  it('keeps the production guard in a production-mode marketing bundle', async () => {
    const sales = await bundleSource('apps/marketing/src/sales/client.ts', {
      'import.meta.env.MODE': '"production"',
      'import.meta.env.VITE_SALES_BACKEND': '"production"',
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': '"zelvoropos"',
      'import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION': '"europe-west1"',
    });
    expect(sales).toContain('zelvoropos');
    expect(sales).toContain('cloudfunctions.net');
    expect(sales).not.toContain('europe-west1-zelvoropos-stage.cloudfunctions.net');
  });
});

