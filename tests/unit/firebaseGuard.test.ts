import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkFirebaseTargets,
  deploymentRoleProblems,
  loadIsolationConfig,
  marketingConfigProblems,
  resolveActiveProject,
  roleForDeployTarget,
  marketingBundleProblems,
  marketingDeployProblems,
  marketingHostingProblems,
  stagingHostingProblems,
} from '../../scripts/firebase-guard.mjs';

const iso = {
  blocked: {
    projectIds: ['pos-catch', 'pos-catch-test'],
    projectNumbers: ['891436013106'],
    hostingSites: ['pos-catch', 'pos-catch-test', 'pos-catch--test'],
    apiKeySha256: [],
    appIdSha256: [],
  },
  placeholderProjectIds: ['', 'your-new-project-id', 'zelvero-pos-REPLACE-ME'],
  emulatorProjectPrefix: 'demo-',
  productionProjectId: 'zelvoropos',
  stagingProjectId: '',
};

const validMarketing = {
  VITE_FIREBASE_PROJECT_ID: 'zelvoropos',
  VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
};

describe('marketing environment stays separate', () => {
  it('accepts a project id and region without POS web-app keys', () => {
    expect(marketingConfigProblems({ exists: true, env: validMarketing, fnRegion: 'europe-west1', iso })).toEqual([]);
  });

  it('fails closed when the marketing environment file is missing', () => {
    const problems = marketingConfigProblems({ exists: false, env: {}, fnRegion: 'europe-west1', iso });
    expect(problems).toEqual(['Marketing environment file apps/marketing/.env.production is missing.']);
  });

  it('rejects a placeholder marketing project id', () => {
    const problems = marketingConfigProblems({
      exists: true,
      env: { ...validMarketing, VITE_FIREBASE_PROJECT_ID: 'your-new-project-id' },
      fnRegion: 'europe-west1',
      iso,
    });
    expect(problems).toEqual(['Marketing VITE_FIREBASE_PROJECT_ID "your-new-project-id" is a placeholder.']);
  });

  it('rejects a blocked marketing project id', () => {
    for (const projectId of ['pos-catch', 'pos-catch-test']) {
      const problems = marketingConfigProblems({
        exists: true,
        env: { ...validMarketing, VITE_FIREBASE_PROJECT_ID: projectId },
        fnRegion: 'europe-west1',
        iso,
      });
      expect(problems[0]).toContain('blocked');
    }
  });

  it('does not apply POS web-config rules to the marketing env', () => {
    const problems = marketingConfigProblems({
      exists: true,
      env: { ...validMarketing, VITE_USE_FIREBASE_EMULATORS: 'true' },
      fnRegion: 'europe-west1',
      iso,
    });
    expect(problems).toEqual([]);
  });

  it('does not copy a marketing project id into the POS target check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zelvero-guard-'));
    const marketingEnvFile = join(dir, '.env.production');
    writeFileSync(marketingEnvFile, 'VITE_FIREBASE_PROJECT_ID=pos-catch\nVITE_FIREBASE_FUNCTIONS_REGION=europe-west1\n', 'utf8');
    try {
      const { problems, active } = checkFirebaseTargets({ requireMarketingEnv: true, marketingEnvFile, role: 'production' });
      expect(active).toBe('zelvoropos');
      expect(problems.some((problem) => problem.includes('Marketing VITE_FIREBASE_PROJECT_ID "pos-catch" is a blocked project.'))).toBe(true);
      expect(problems.some((problem) => problem.includes('VITE_FIREBASE_PROJECT_ID is the OLD project'))).toBe(false);
      expect(problems.some((problem) => problem.includes('Missing production web config'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('deployment roles', () => {
  it('sends production commands, including a named function, to the production role', () => {
    expect(roleForDeployTarget('all')).toBe('production');
    expect(roleForDeployTarget('hosting')).toBe('production');
    expect(roleForDeployTarget('functions')).toBe('production');
    expect(roleForDeployTarget('rules')).toBe('production');
    expect(roleForDeployTarget('functions:posCheckout')).toBe('production');
    expect(roleForDeployTarget('staging')).toBe('staging');
  });

  it('accepts a production deploy aimed at zelvoropos', () => {
    expect(deploymentRoleProblems({ role: 'production', active: 'zelvoropos', iso })).toEqual([]);
  });

  it('rejects a production deploy aimed at another project', () => {
    const problems = deploymentRoleProblems({ role: 'production', active: 'other-project', iso });
    expect(problems.some((problem) => problem.includes('must target "zelvoropos"'))).toBe(true);
  });

  it('stops staging deploys while no staging project is configured', () => {
    const problems = deploymentRoleProblems({ role: 'staging', active: 'zelvoropos', iso });
    expect(problems).toContain('Staging project is not configured. Staging deployment is disabled.');
    expect(problems.some((problem) => problem.includes('Refusing to deploy staging to the production project'))).toBe(true);
  });

  it('rejects production and emulator ids as the staging project', () => {
    const production = deploymentRoleProblems({
      role: 'staging',
      active: 'zelvoropos',
      iso: { ...iso, stagingProjectId: 'zelvoropos' },
    });
    expect(production.some((problem) => problem.includes('different project from production'))).toBe(true);

    const emulator = deploymentRoleProblems({
      role: 'staging',
      active: 'demo-zelvero',
      iso: { ...iso, stagingProjectId: 'demo-zelvero' },
    });
    expect(emulator).toEqual(['Staging project id "demo-zelvero" is an emulator project and cannot be deployed.']);
  });

  it('accepts a staging role only when the target is a different configured project', () => {
    const problems = deploymentRoleProblems({
      role: 'staging',
      active: 'zelvero-staging-example',
      iso: { ...iso, stagingProjectId: 'zelvero-staging-example' },
    });
    expect(problems).toEqual([]);
    const wrongTarget = deploymentRoleProblems({
      role: 'staging',
      active: 'zelvoropos',
      iso: { ...iso, stagingProjectId: 'zelvero-staging-example' },
    });
    expect(wrongTarget.some((problem) => problem.includes('Refusing to deploy staging to the production project'))).toBe(true);
  });

  it('keeps the blocked list and points the live staging config at zelvoropos-stage', () => {
    const live = loadIsolationConfig();
    expect(live.blocked.projectIds).toEqual(['pos-catch', 'pos-catch-test']);
    expect(live.productionProjectId).toBe('zelvoropos');
    expect(live.stagingProjectId).toBe('zelvoropos-stage');
    expect(live.emulatorProjectPrefix).toBe('demo-');
    expect(live.productionHostingSites).toEqual(['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging']);
    expect(live.stagingHostingSites).toEqual({ pos: 'zelvoropos-stage', marketing: 'zelvoropos-stage-web' });
    const staging = checkFirebaseTargets({ role: 'staging' });
    expect(staging.active).toBe('zelvoropos-stage');
    expect(staging.problems).toEqual([]);
  });

  it('selects the staging project instead of the production default', () => {
    expect(resolveActiveProject({ role: 'production', rcDefault: 'zelvoropos' })).toBe('zelvoropos');
    expect(resolveActiveProject({ role: 'staging', stagingProjectId: '', rcDefault: 'zelvoropos' })).toBe('zelvoropos');
    expect(
      resolveActiveProject({ role: 'staging', stagingProjectId: 'zelvero-staging-example', rcDefault: 'zelvoropos' }),
    ).toBe('zelvero-staging-example');
    expect(
      resolveActiveProject({
        role: 'staging',
        projectFromCli: 'zelvero-staging-example',
        stagingProjectId: 'zelvero-staging-example',
        rcDefault: 'zelvoropos',
      }),
    ).toBe('zelvero-staging-example');
  });

  it('refuses staging hosting until the staging project has its own sites', () => {
    const problems = stagingHostingProblems({ iso, rc: { targets: {} } });
    expect(problems).toContain('Staging POS hosting site is not configured.');
    expect(problems).toContain('Staging marketing hosting site is not configured.');
    expect(problems).toContain('Staging hosting targets cannot be selected until stagingProjectId is set.');

    const configured = {
      ...iso,
      stagingProjectId: 'zelvero-staging-example',
      stagingHostingSites: { pos: 'zelvero-pos-staging-example', marketing: 'zelvero-web-staging-example' },
      productionHostingSites: ['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging'],
    };
    const rc = {
      targets: {
        'zelvero-staging-example': {
          hosting: {
            staging: ['zelvero-pos-staging-example'],
            'web-staging': ['zelvero-web-staging-example'],
          },
        },
      },
    };
    expect(stagingHostingProblems({ iso: configured, rc })).toEqual([]);
    const productionSite = stagingHostingProblems({
      iso: configured,
      rc: {
        targets: {
          'zelvero-staging-example': {
            hosting: {
              staging: ['zelvoropos-staging'],
              'web-staging': ['zelvero-web-staging-example'],
            },
          },
        },
      },
    });
    expect(productionSite.some((problem) => problem.includes('zelvoropos-staging'))).toBe(true);
    expect(productionSite.some((problem) => problem.includes('must be exactly'))).toBe(true);
  });

  it('maps the dedicated staging hosts and still rejects the production sites', () => {
    const configured = {
      ...iso,
      stagingProjectId: 'zelvoropos-stage',
      productionProjectId: 'zelvoropos',
      stagingHostingSites: { pos: 'zelvoropos-stage', marketing: 'zelvoropos-stage-web' },
      productionHostingSites: ['zelvoropos', 'zelvoropos-staging', 'zelvero-web-staging'],
    };
    const rc = {
      targets: {
        'zelvoropos-stage': {
          hosting: {
            staging: ['zelvoropos-stage'],
            'web-staging': ['zelvoropos-stage-web'],
          },
        },
      },
    };
    expect(stagingHostingProblems({ iso: configured, rc })).toEqual([]);
    const borrowed = stagingHostingProblems({
      iso: { ...configured, stagingHostingSites: { pos: 'zelvoropos', marketing: 'zelvero-web-staging' } },
      rc: {
        targets: {
          'zelvoropos-stage': {
            hosting: { staging: ['zelvoropos'], 'web-staging': ['zelvero-web-staging'] },
          },
        },
      },
    });
    expect(borrowed.some((problem) => problem.includes('zelvoropos'))).toBe(true);
    expect(borrowed.some((problem) => problem.includes('zelvero-web-staging'))).toBe(true);
  });

  it('keeps emulator runs on demo-* projects and ignores the marketing file there', () => {
    const rejected = checkFirebaseTargets({ emulator: true, projectFromCli: 'zelvoropos' });
    expect(rejected.problems.some((problem) => problem.includes('demo-'))).toBe(true);
    const accepted = checkFirebaseTargets({ emulator: true, projectFromCli: 'demo-zelvero' });
    expect(accepted.problems.some((problem) => problem.includes('Marketing environment') || problem.includes('Staging project'))).toBe(false);
  });
});

describe('marketing hosting directories stay separated', () => {
  const firebase = {
    hosting: [
      { target: 'production', public: 'dist' },
      { target: 'staging', public: 'release-dist' },
      { target: 'web-staging', public: 'apps/marketing/staging-dist' },
      { target: 'marketing', public: 'apps/marketing/dist' },
    ],
  };
  const iso = {
    productionProjectId: 'zelvoropos',
    stagingProjectId: 'zelvoropos-stage',
    stagingHostingSites: { pos: 'zelvoropos-stage', marketing: 'zelvoropos-stage-web' },
  };
  const rc = {
    targets: {
      zelvoropos: { hosting: { production: ['zelvoropos'], staging: ['zelvoropos-staging'], marketing: ['zelvero-web-staging'] } },
      'zelvoropos-stage': { hosting: { staging: ['zelvoropos-stage'], 'web-staging': ['zelvoropos-stage-web'] } },
    },
  };

  it('accepts the live production and staging marketing mapping', () => {
    expect(marketingHostingProblems({ firebase, rc, iso })).toEqual([]);
    expect(marketingDeployProblems({ projectId: 'zelvoropos', target: 'marketing', publicDir: 'apps/marketing/dist', iso })).toEqual([]);
    expect(marketingDeployProblems({ projectId: 'zelvoropos-stage', target: 'web-staging', publicDir: 'apps/marketing/staging-dist', iso })).toEqual([]);
    expect(checkFirebaseTargets({ role: 'production' }).problems.filter((problem) => problem.includes('marketing') || problem.includes('web-staging'))).toEqual([]);
  });

  it('refuses a production project pointed at the staging bundle or a staging project pointed at the production bundle', () => {
    const swappedDir = marketingHostingProblems({
      firebase: {
        hosting: firebase.hosting.map((item) => item.target === 'marketing' ? { ...item, public: 'apps/marketing/staging-dist' } : item),
      },
      rc,
      iso,
    });
    expect(swappedDir.some((problem) => problem.includes('apps/marketing/dist'))).toBe(true);
    const productionHasStagingTarget = marketingHostingProblems({
      firebase,
      rc: {
        targets: {
          ...rc.targets,
          zelvoropos: { hosting: { ...rc.targets.zelvoropos.hosting, 'web-staging': ['zelvero-web-staging'] } },
        },
      },
      iso,
    });
    expect(productionHasStagingTarget.some((problem) => problem.includes('must not have a "web-staging"'))).toBe(true);
    const stagingHasProductionTarget = marketingHostingProblems({
      firebase,
      rc: {
        targets: {
          ...rc.targets,
          'zelvoropos-stage': { hosting: { ...rc.targets['zelvoropos-stage'].hosting, marketing: ['zelvoropos-stage-web'] } },
        },
      },
      iso,
    });
    expect(stagingHasProductionTarget.some((problem) => problem.includes('must not have a "marketing"'))).toBe(true);
    expect(marketingDeployProblems({ projectId: 'zelvoropos', target: 'web-staging', publicDir: 'apps/marketing/staging-dist', iso })).not.toEqual([]);
    expect(marketingDeployProblems({ projectId: 'zelvoropos-stage', target: 'marketing', publicDir: 'apps/marketing/dist', iso })).not.toEqual([]);
  });

  it('refuses a bundle that names the other project', () => {
    expect(marketingBundleProblems('production', 'jt=`zelvoropos`,Mt=`europe-west1`')).toEqual([]);
    expect(marketingBundleProblems('staging', 'jt=`zelvoropos-stage`,Mt=`europe-west1`')).toEqual([]);
    expect(marketingBundleProblems('production', 'jt=`zelvoropos-stage`').some((problem) => problem.includes('staging project'))).toBe(true);
    expect(marketingBundleProblems('staging', 'https://europe-west1-zelvoropos.cloudfunctions.net').some((problem) => problem.includes('production project'))).toBe(true);
  });
});
