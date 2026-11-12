/** Retired separate-project channel. The Preview tab lives in the existing Super Admin. */
export const SUPERADMIN_PREVIEW_CHANNEL = 'superadmin-preview';

export function isSuperAdminPreviewChannel(channel: string | undefined): boolean {
  return String(channel ?? '').toLowerCase() === SUPERADMIN_PREVIEW_CHANNEL;
}
