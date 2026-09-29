import { readFileSync } from 'node:fs';

interface IsolationConfig {
  blocked: { projectIds: string[]; projectNumbers: string[] };
  placeholderProjectIds: string[];
}

function loadConfig(): IsolationConfig {
  const raw = readFileSync(new URL('../isolation.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as IsolationConfig;
}

function currentProjectId(): string {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.FIREBASE_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string };
      if (cfg.projectId) return cfg.projectId;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/**
 * Refuses to run inside the old CATCH POS project (or an unconfigured placeholder). Runs at module
 * load, so a mistaken deploy fails during code discovery and never serves a request.
 */
export function assertIsolatedProject(): string {
  const config = loadConfig();
  const projectId = currentProjectId();
  const blocked = [...config.blocked.projectIds, ...config.blocked.projectNumbers].map((s) => s.toLowerCase());
  if (blocked.includes(projectId.toLowerCase())) {
    throw new Error(`[zelvero] Refusing to run in blocked Firebase project "${projectId}" (old CATCH POS).`);
  }
  if (projectId && config.placeholderProjectIds.includes(projectId)) {
    throw new Error(`[zelvero] Firebase project id is still the placeholder "${projectId}".`);
  }
  return projectId;
}
