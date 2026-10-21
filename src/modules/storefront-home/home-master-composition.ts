/**
 * Phase D — Cover / Contain / Manual composition math for Concept D frames.
 * Server-side Sharp renders the final WebP; storefront shows the baked file.
 */

export type ImageFitMode = 'cover' | 'contain' | 'manual';
export type ImageBackgroundMode = 'blur' | 'solid';

export type VariantComposition = {
  fit: ImageFitMode;
  /** Manual only: 1 = full image visible (contain scale); higher zooms in. */
  zoom: number;
  /** 0–100 focal / pan anchor (cover + manual crop). */
  panX: number;
  panY: number;
  backgroundMode: ImageBackgroundMode;
  /** #RRGGBB solid fill when backgroundMode is solid. */
  backgroundColor: string;
};

export const MANUAL_ZOOM_MIN = 1;
export const MANUAL_ZOOM_MAX = 4;
export const DEFAULT_BACKGROUND_COLOR = '#1a1a1a';

export function defaultVariantComposition(
  partial?: Partial<VariantComposition>,
): VariantComposition {
  return {
    fit: 'cover',
    zoom: 1,
    panX: 50,
    panY: 50,
    backgroundMode: 'blur',
    backgroundColor: DEFAULT_BACKGROUND_COLOR,
    ...partial,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function parseFitMode(raw: unknown): ImageFitMode {
  if (raw === 'contain' || raw === 'manual' || raw === 'cover') return raw;
  return 'cover';
}

export function parseBackgroundMode(raw: unknown): ImageBackgroundMode {
  return raw === 'solid' ? 'solid' : 'blur';
}

export function parseBackgroundColor(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_BACKGROUND_COLOR;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_BACKGROUND_COLOR;
}

export function parseVariantComposition(raw: unknown): VariantComposition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultVariantComposition();
  }
  const row = raw as Record<string, unknown>;
  const fit = parseFitMode(row.fit);
  const zoomRaw = Number(row.zoom);
  const panXRaw = Number(row.panX ?? row.focusX);
  const panYRaw = Number(row.panY ?? row.focusY);
  return defaultVariantComposition({
    fit,
    zoom: Number.isFinite(zoomRaw)
      ? clamp(zoomRaw, MANUAL_ZOOM_MIN, MANUAL_ZOOM_MAX)
      : 1,
    panX: Number.isFinite(panXRaw) ? clamp(panXRaw, 0, 100) : 50,
    panY: Number.isFinite(panYRaw) ? clamp(panYRaw, 0, 100) : 50,
    backgroundMode: parseBackgroundMode(row.backgroundMode),
    backgroundColor: parseBackgroundColor(row.backgroundColor),
  });
}

/**
 * Cover crop window (source pixels) for a target aspect, anchored on pan %.
 */
export function coverCropWindow(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  panX: number,
  panY: number,
): { left: number; top: number; width: number; height: number } {
  const targetAspect = outW / Math.max(1, outH);
  const srcAspect = srcW / Math.max(1, srcH);
  let width: number;
  let height: number;
  if (srcAspect > targetAspect) {
    height = srcH;
    width = Math.max(1, Math.min(srcW, Math.floor(srcH * targetAspect)));
  } else {
    width = srcW;
    height = Math.max(1, Math.min(srcH, Math.floor(srcW / targetAspect)));
  }
  const focusX = (clamp(panX, 0, 100) / 100) * srcW;
  const focusY = (clamp(panY, 0, 100) / 100) * srcH;
  let left = Math.floor(focusX - width / 2);
  let top = Math.floor(focusY - height / 2);
  left = clamp(left, 0, Math.max(0, srcW - width));
  top = clamp(top, 0, Math.max(0, srcH - height));
  width = Math.min(width, srcW - left);
  height = Math.min(height, srcH - top);
  return { left, top, width: Math.max(1, width), height: Math.max(1, height) };
}

export function containScale(srcW: number, srcH: number, outW: number, outH: number): number {
  return Math.min(outW / Math.max(1, srcW), outH / Math.max(1, srcH));
}

export function coverScale(srcW: number, srcH: number, outW: number, outH: number): number {
  return Math.max(outW / Math.max(1, srcW), outH / Math.max(1, srcH));
}

/**
 * Manual composition: zoom≥1 multiplies contain scale.
 * When the scaled image exceeds the frame, returns a source-space extract window.
 * When it fits inside, returns null extract (caller letterboxes).
 */
export function manualCompositionPlan(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  composition: VariantComposition,
): {
  scale: number;
  letterbox: boolean;
  extract: { left: number; top: number; width: number; height: number } | null;
  placedWidth: number;
  placedHeight: number;
  offsetX: number;
  offsetY: number;
} {
  const base = containScale(srcW, srcH, outW, outH);
  const zoom = clamp(composition.zoom, MANUAL_ZOOM_MIN, MANUAL_ZOOM_MAX);
  const scale = base * zoom;
  const placedWidth = srcW * scale;
  const placedHeight = srcH * scale;

  if (placedWidth <= outW + 0.5 && placedHeight <= outH + 0.5) {
    const spareX = Math.max(0, outW - placedWidth);
    const spareY = Math.max(0, outH - placedHeight);
    const offsetX = Math.floor((spareX * clamp(composition.panX, 0, 100)) / 100);
    const offsetY = Math.floor((spareY * clamp(composition.panY, 0, 100)) / 100);
    return {
      scale,
      letterbox: true,
      extract: null,
      placedWidth: Math.max(1, Math.round(placedWidth)),
      placedHeight: Math.max(1, Math.round(placedHeight)),
      offsetX,
      offsetY,
    };
  }

  // Source-space viewport that maps to the output frame after scaling.
  const viewW = Math.min(srcW, Math.max(1, Math.ceil(outW / scale)));
  const viewH = Math.min(srcH, Math.max(1, Math.ceil(outH / scale)));
  const focusX = (clamp(composition.panX, 0, 100) / 100) * srcW;
  const focusY = (clamp(composition.panY, 0, 100) / 100) * srcH;
  let left = Math.floor(focusX - viewW / 2);
  let top = Math.floor(focusY - viewH / 2);
  left = clamp(left, 0, Math.max(0, srcW - viewW));
  top = clamp(top, 0, Math.max(0, srcH - viewH));
  const width = Math.min(viewW, srcW - left);
  const height = Math.min(viewH, srcH - top);
  return {
    scale,
    letterbox: false,
    extract: { left, top, width: Math.max(1, width), height: Math.max(1, height) },
    placedWidth: outW,
    placedHeight: outH,
    offsetX: 0,
    offsetY: 0,
  };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const safe = parseBackgroundColor(hex);
  return {
    r: parseInt(safe.slice(1, 3), 16),
    g: parseInt(safe.slice(3, 5), 16),
    b: parseInt(safe.slice(5, 7), 16),
  };
}
