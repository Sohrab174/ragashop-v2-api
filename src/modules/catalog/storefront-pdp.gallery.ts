/**
 * PDP gallery: cover first, then photo galleries, dedupe by path.
 * Skips empty / obviously unusable path strings (no DB mutation).
 */

import { ProductGalleryType } from '../product/entities/product-gallery.entity';
import type { StorefrontPdpImage } from './storefront-pdp.types';

export type RawPdpGalleryRow = {
  id?: number | null;
  pathFile?: string | null;
  type?: string | null;
};

export type RawPdpCover = {
  id?: number | null;
  pathFile?: string | null;
} | null;

/** Reject empty / placeholder / non-path strings before they reach the client. */
export function isUsableGalleryPath(path: string | null | undefined): boolean {
  if (path == null) return false;
  const trimmed = String(path).trim();
  if (!trimmed) return false;
  if (trimmed === '/' || trimmed === '#' || trimmed === '.') return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'n/a')
    return false;
  return true;
}

function normalizePath(path: string | null | undefined): string | null {
  if (!isUsableGalleryPath(path)) return null;
  return String(path).trim();
}

/**
 * Build ordered, deduplicated image list for PDP.
 * Cover leads when present; gallery photos follow; duplicate paths skipped.
 * Videos are excluded from the image gallery.
 */
export function buildStorefrontPdpGallery(
  cover: RawPdpCover,
  galleries: RawPdpGalleryRow[] | null | undefined,
): StorefrontPdpImage[] {
  const out: StorefrontPdpImage[] = [];
  const seen = new Set<string>();

  const push = (id: number | null, pathFile: string | null | undefined) => {
    const path = normalizePath(pathFile);
    if (!path) return;
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ id, path });
  };

  if (cover) {
    push(cover.id != null ? Number(cover.id) : null, cover.pathFile);
  }

  const rows = Array.isArray(galleries) ? galleries : [];
  for (const row of rows) {
    if (row?.type && row.type !== ProductGalleryType.photo) continue;
    push(row.id != null ? Number(row.id) : null, row.pathFile);
  }

  return out;
}
