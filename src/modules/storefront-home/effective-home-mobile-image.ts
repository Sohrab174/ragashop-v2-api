/**
 * Effective mobile hero image for public/preview DTOs.
 * override → generated → legacy mobileImagePath → desktop.
 */

export type HomeMobileImageSource = {
  mobileImageOverridePath?: string | null;
  generatedMobileImagePath?: string | null;
  mobileImagePath?: string | null;
  desktopImagePath?: string | null;
};

export function effectiveMobileImagePath(
  row: HomeMobileImageSource | null | undefined,
): string | null {
  if (!row) return null;
  return (
    row.mobileImageOverridePath ||
    row.generatedMobileImagePath ||
    row.mobileImagePath ||
    row.desktopImagePath ||
    null
  );
}
