export function parseDotEnv(file: string): Record<string, string>;

export function stagingWebEnvProblems(input: {
  kind: 'pos' | 'marketing';
  env?: Record<string, string | undefined>;
  iso: {
    blocked?: { projectIds?: string[] };
    placeholderProjectIds?: string[];
    emulatorProjectPrefix?: string;
    productionProjectId?: string;
    stagingProjectId?: string;
    productionHostingSites?: string[];
  };
  fnRegion?: string;
  productionEnv?: Record<string, string | undefined>;
}): string[];

export function productionBundleMarkers(input?: {
  productionProjectId?: string;
  functionsRegion?: string;
  productionEnv?: Record<string, string | undefined>;
  productionHostingSites?: string[];
}): Array<{ label: string; needle: string; match?: string }>;

export function stagingBundleProblems(
  dir: string,
  markers: Array<{ label: string; needle: string; match?: string }>,
): string[];

export function stagingEnvPath(kind: 'pos' | 'marketing'): string;

export function buildStaging(kind: string): number;

export function assertStagingViteMode(): void;
