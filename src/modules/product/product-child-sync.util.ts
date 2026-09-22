/**
 * Gallery/Description logical identity — mirrored from crawler for admin writes.
 */

export function normalizeGalleryPath(pathFile: string): string {
  return String(pathFile || '')
    .trim()
    .replace(/^https?:\/\/www\.trendyol\.com/i, '')
    .replace(/\\/g, '/');
}

export function galleryLogicalKey(productId: number, pathFile: string): string {
  return `${productId}:${normalizeGalleryPath(pathFile)}`;
}

export function descriptionLogicalKey(
  productId: number,
  source: string | null,
  sourceContent: string,
  displayOrder: number,
): string {
  return `${productId}:${source ?? ''}:${String(
    sourceContent || '',
  ).trim()}:${displayOrder}`;
}

/** Admin/manual descriptions have no crawler source tag. */
export function isAdminOwnedDescription(desc: {
  source?: string | null;
}): boolean {
  return desc.source == null || desc.source === '';
}

export function isCrawlerOwnedDescription(
  desc: { source?: string | null },
  crawlerSource: string,
): boolean {
  return desc.source === crawlerSource;
}
