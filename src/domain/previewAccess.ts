/** Customer release cutover stays on the normal Super Admin app. The preview build cannot start it. */
export function customerReleaseCutoverAllowed(previewBuild: boolean): boolean {
  return previewBuild !== true;
}
