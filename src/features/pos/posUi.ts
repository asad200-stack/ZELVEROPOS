/** The only approved POS product card. Preview and tests both require this id. */
export const POS_UI_ID = 'canonical' as const;
/** Working-tree preview identity. Not a Hosting release. */
export const POS_PREVIEW_RELEASE = '2.0.0-preview';

export function isCanonicalPosUi(value: string | null | undefined): boolean {
  return value === POS_UI_ID;
}
