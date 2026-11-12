/**
 * Prints the only acceptable online Super Admin preview target and then stops.
 * It does not create a Firebase project and does not deploy Hosting, Functions, or rules.
 */
import { pathToFileURL } from 'node:url';
export const SUPERADMIN_PREVIEW_PROJECT_ID = 'zelvoropos-preview';
export const SUPERADMIN_PREVIEW_SITE = 'zelvoropos-preview';
export const SUPERADMIN_PREVIEW_URL = 'https://zelvoropos-preview.web.app';

const FORBIDDEN = new Set(['zelvoropos', 'zelvoropos-stage', 'pos-catch', 'pos-catch-test']);

export function previewDeployRefusal(projectId, approved) {
  const id = String(projectId ?? '').trim().toLowerCase();
  if (!id || FORBIDDEN.has(id) || id.startsWith('demo-')) {
    return `Refusing preview deploy to "${projectId}". Production, staging, and emulator projects are not this preview.`;
  }
  if (id !== SUPERADMIN_PREVIEW_PROJECT_ID) {
    return `Preview deploy only allows "${SUPERADMIN_PREVIEW_PROJECT_ID}".`;
  }
  if (approved !== true) return 'Super Admin preview deploy is not approved. Nothing was deployed.';
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requested = process.argv[2] || SUPERADMIN_PREVIEW_PROJECT_ID;
  const refusal = previewDeployRefusal(requested, false);
  console.log(`Proposed URL: ${SUPERADMIN_PREVIEW_URL}`);
  console.log(`Proposed project: ${SUPERADMIN_PREVIEW_PROJECT_ID}`);
  console.log(`Proposed Hosting site: ${SUPERADMIN_PREVIEW_SITE}`);
  console.error(refusal);
  process.exit(2);
}
