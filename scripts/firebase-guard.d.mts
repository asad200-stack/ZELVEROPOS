export interface IsolationConfig {
  blocked: {
    projectIds: string[];
    projectNumbers: string[];
    hostingSites: string[];
    apiKeySha256: string[];
    appIdSha256: string[];
  };
  placeholderProjectIds: string[];
  emulatorProjectPrefix: string;
  productionProjectId: string;
  stagingProjectId: string;
  productionHostingSites?: string[];
  stagingHostingSites?: { pos?: string; marketing?: string };
}

export function loadIsolationConfig(): IsolationConfig;

export function marketingConfigProblems(input: {
  exists: boolean;
  env?: Record<string, string | undefined>;
  fnRegion?: string;
  iso: IsolationConfig;
}): string[];

export function deploymentRoleProblems(input: {
  role: string;
  active?: string;
  iso: IsolationConfig;
}): string[];

export function resolveActiveProject(input?: {
  projectFromCli?: string;
  hookProject?: string;
  role?: string;
  stagingProjectId?: string;
  rcDefault?: string;
}): string;

export function roleForDeployTarget(target: string): 'production' | 'staging';

export function stagingHostingProblems(input: {
  iso: IsolationConfig;
  rc?: { targets?: Record<string, { hosting?: Record<string, string[]> }> };
}): string[];

export function marketingHostingProblems(input?: {
  firebase?: { hosting?: Array<{ target?: string; public?: string }> };
  rc?: { targets?: Record<string, { hosting?: Record<string, string[] | undefined> }> };
  iso?: {
    productionProjectId?: string;
    stagingProjectId?: string;
    stagingHostingSites?: { marketing?: string };
  };
}): string[];

export function marketingDeployProblems(input?: {
  projectId?: string;
  target?: string;
  publicDir?: string;
  iso?: {
    productionProjectId?: string;
    stagingProjectId?: string;
  };
}): string[];

export function marketingBundleProblems(role: string, text?: string): string[];

export function checkFirebaseTargets(input?: {
  projectFromCli?: string;
  hook?: boolean;
  emulator?: boolean;
  role?: string;
  requireMarketingEnv?: boolean;
  marketingEnvFile?: string;
}): { problems: string[]; active: string };
