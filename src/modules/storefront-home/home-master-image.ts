import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import * as sharp from 'sharp';
import {
  detectHomeRasterFormat,
  homeRasterExt,
  looksLikeActiveOrNonRaster,
  type HomeRasterFormat,
} from './home-image-upload';
import {
  coverCropWindow as compositionCoverCropWindow,
  defaultVariantComposition,
  hexToRgb,
  manualCompositionPlan,
  parseVariantComposition,
  type VariantComposition,
} from './home-master-composition';

export {
  defaultVariantComposition,
  manualCompositionPlan,
  parseVariantComposition,
  type ImageBackgroundMode,
  type ImageFitMode,
  type VariantComposition,
} from './home-master-composition';

/** Master upload only — does not change the legacy 1 MB home route. */
export const HOME_MASTER_MAX_BYTES = 10 * 1024 * 1024;
export const HOME_MASTER_MAX_EDGE = 8000;
export const HOME_MASTER_MAX_PIXELS = 40_000_000;
export const HOME_MASTER_WEBP_QUALITY = 82;
export const HOME_MASTER_PREVIEW_MAX_EDGE = 1600;

/** Private retained masters (not served by public /static/home). */
export const HOME_MASTERS_DIR = 'home-masters';
/** Public cropped outputs + editor previews. */
export const HOME_OUTPUT_DIR = 'home';

export type HomeMasterProfile = 'hero' | 'category' | 'pets';

export type HomeMasterVariantKey = 'desktop' | 'mobile' | 'mobileWide';

export type HomeMasterVariantSpec = {
  key: HomeMasterVariantKey;
  width: number;
  height: number;
};

/**
 * Output sizes matched to Concept D frames.
 * Crop uses cover + focal point; never stretch or upscale beyond source.
 *
 * category also produces mobileWide (≈2.15:1) for the odd-last mobile banner.
 * pets uses the wide mobile as its primary mobile variant.
 */
export const HOME_MASTER_PROFILES: Record<
  HomeMasterProfile,
  {
    desktop: HomeMasterVariantSpec;
    mobile: HomeMasterVariantSpec;
    mobileWide?: HomeMasterVariantSpec;
  }
> = {
  hero: {
    desktop: { key: 'desktop', width: 2400, height: 1021 },
    mobile: { key: 'mobile', width: 1500, height: 1200 },
  },
  category: {
    desktop: { key: 'desktop', width: 1200, height: 1000 },
    mobile: { key: 'mobile', width: 1100, height: 1050 },
    mobileWide: { key: 'mobileWide', width: 1600, height: 744 },
  },
  pets: {
    desktop: { key: 'desktop', width: 1200, height: 1000 },
    mobile: { key: 'mobile', width: 1600, height: 744 },
  },
};

export type FocalPointPercent = { x: number; y: number };

export type HomeMasterProcessResult = {
  masterPath: string;
  masterFilename: string;
  masterPreviewPath: string;
  desktopPath: string;
  mobilePath: string;
  mobileWidePath?: string;
  desktopFilename: string;
  mobileFilename: string;
  mobileWideFilename?: string;
  profile: HomeMasterProfile;
  desktopWidth: number;
  desktopHeight: number;
  mobileWidth: number;
  mobileHeight: number;
  mobileWideWidth?: number;
  mobileWideHeight?: number;
};

export function isHomeMasterProfile(value: unknown): value is HomeMasterProfile {
  return value === 'hero' || value === 'category' || value === 'pets';
}

export function parseFocalPoint(
  rawX: unknown,
  rawY: unknown,
  fallback: FocalPointPercent = { x: 50, y: 50 },
): FocalPointPercent {
  const x = Number(rawX);
  const y = Number(rawY);
  return {
    x: Number.isFinite(x) ? clamp(x, 0, 100) : fallback.x,
    y: Number.isFinite(y) ? clamp(y, 0, 100) : fallback.y,
  };
}

/**
 * Cover-crop window in source pixels for a target aspect, anchored on focus %.
 * Guarantees left/top/width/height stay inside the source (Sharp extract-safe).
 */
export function coverCropWindow(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  focus: FocalPointPercent,
): { left: number; top: number; width: number; height: number } {
  return compositionCoverCropWindow(srcW, srcH, outW, outH, focus.x, focus.y);
}

export function outputSizeForCrop(
  cropW: number,
  cropH: number,
  targetW: number,
  targetH: number,
): { width: number; height: number } {
  if (cropW >= targetW && cropH >= targetH) {
    return { width: targetW, height: targetH };
  }
  return { width: Math.max(1, cropW), height: Math.max(1, cropH) };
}

/** Sanitize retained-master logical paths: `/home-masters/{uuid.ext}` only. */
export function sanitizeHomeMasterPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim().replace(/\\/g, '/');
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!normalized.startsWith(`/${HOME_MASTERS_DIR}/`)) return undefined;
  if (normalized.includes('..')) return undefined;
  if (!/^\/home-masters\/[a-zA-Z0-9._-]+$/.test(normalized)) return undefined;
  return normalized;
}

export function resolveHomeMasterAbsolutePath(logicalPath: string): string | null {
  const safe = sanitizeHomeMasterPath(logicalPath);
  if (!safe) return null;
  const filename = path.basename(safe);
  const abs = path.resolve('./uploads', HOME_MASTERS_DIR, filename);
  const root = path.resolve('./uploads', HOME_MASTERS_DIR);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return abs;
}

async function assertSafeMasterBuffer(buffer: Buffer): Promise<HomeRasterFormat> {
  if (!buffer?.length) throw new Error('EMPTY_IMAGE');
  if (buffer.length > HOME_MASTER_MAX_BYTES) throw new Error('OVERSIZED_UPLOAD');
  if (looksLikeActiveOrNonRaster(buffer)) throw new Error('UNSUPPORTED_TYPE');
  const format = await detectHomeRasterFormat(buffer);
  if (format) return format;
  // Fallback for already-retained masters (e.g. earlier mozjpeg encodes) that
  // Sharp can decode but the strict receipt container checks reject.
  try {
    const meta = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: HOME_MASTER_MAX_PIXELS,
    }).metadata();
    if (meta.format === 'jpeg') return 'jpeg';
    if (meta.format === 'png') return 'png';
    if (meta.format === 'webp') return 'webp';
  } catch {
    // fall through
  }
  throw new Error('CORRUPT_OR_UNSUPPORTED');
}

export async function inspectMasterSource(buffer: Buffer): Promise<{
  width: number;
  height: number;
  format: HomeRasterFormat;
  oriented: Buffer;
}> {
  const format = await assertSafeMasterBuffer(buffer);
  const oriented = await sharp(buffer, {
    failOn: 'error',
    limitInputPixels: HOME_MASTER_MAX_PIXELS,
  })
    .rotate()
    .toBuffer();
  const meta = await sharp(oriented, {
    failOn: 'error',
    limitInputPixels: HOME_MASTER_MAX_PIXELS,
  }).metadata();
  const width = Number(meta.width) || 0;
  const height = Number(meta.height) || 0;
  if (width < 32 || height < 32) throw new Error('IMAGE_TOO_SMALL');
  if (width > HOME_MASTER_MAX_EDGE || height > HOME_MASTER_MAX_EDGE) {
    throw new Error('IMAGE_DIMENSIONS_EXCEEDED');
  }
  if (width * height > HOME_MASTER_MAX_PIXELS) {
    throw new Error('IMAGE_PIXELS_EXCEEDED');
  }
  return { width, height, format, oriented };
}

async function sharpSource(buffer: Buffer) {
  return sharp(buffer, {
    failOn: 'error',
    limitInputPixels: HOME_MASTER_MAX_PIXELS,
  });
}

async function buildBackgroundCanvas(
  buffer: Buffer,
  outW: number,
  outH: number,
  composition: VariantComposition,
): Promise<Buffer> {
  if (composition.backgroundMode === 'solid') {
    const rgb = hexToRgb(composition.backgroundColor);
    return sharp({
      create: {
        width: outW,
        height: outH,
        channels: 3,
        background: rgb,
      },
    })
      .webp({ quality: HOME_MASTER_WEBP_QUALITY, effort: 4 })
      .toBuffer();
  }
  // Blurred extension of the source — cover the frame then soft-blur.
  return (await sharpSource(buffer))
    .resize(outW, outH, { fit: 'cover', position: 'centre' })
    .blur(28)
    .modulate({ brightness: 0.85 })
    .webp({ quality: 70, effort: 4 })
    .toBuffer();
}

async function renderLetterboxed(options: {
  buffer: Buffer;
  srcW: number;
  srcH: number;
  outW: number;
  outH: number;
  placedWidth: number;
  placedHeight: number;
  offsetX: number;
  offsetY: number;
  composition: VariantComposition;
  destDir: string;
}): Promise<{ filename: string; width: number; height: number; absPath: string }> {
  const foreground = await (await sharpSource(options.buffer))
    .resize(options.placedWidth, options.placedHeight, {
      fit: 'fill',
      withoutEnlargement: false,
    })
    .webp({ quality: HOME_MASTER_WEBP_QUALITY, effort: 4 })
    .toBuffer();
  const background = await buildBackgroundCanvas(
    options.buffer,
    options.outW,
    options.outH,
    options.composition,
  );
  const filename = `${uuid()}.webp`;
  const absPath = path.join(options.destDir, filename);
  await sharp(background)
    .composite([
      {
        input: foreground,
        left: clamp(options.offsetX, 0, Math.max(0, options.outW - options.placedWidth)),
        top: clamp(options.offsetY, 0, Math.max(0, options.outH - options.placedHeight)),
      },
    ])
    .webp({ quality: HOME_MASTER_WEBP_QUALITY, effort: 4 })
    .toFile(absPath);
  return { filename, width: options.outW, height: options.outH, absPath };
}

async function renderVariant(options: {
  buffer: Buffer;
  srcW: number;
  srcH: number;
  spec: HomeMasterVariantSpec;
  focus: FocalPointPercent;
  composition?: VariantComposition;
  destDir: string;
}): Promise<{ filename: string; width: number; height: number; absPath: string }> {
  const composition = options.composition
    ? parseVariantComposition(options.composition)
    : defaultVariantComposition({
        fit: 'cover',
        panX: options.focus.x,
        panY: options.focus.y,
      });
  const outW = options.spec.width;
  const outH = options.spec.height;

  if (composition.fit === 'contain') {
    const scale = Math.min(outW / options.srcW, outH / options.srcH);
    const placedWidth = Math.max(1, Math.round(options.srcW * scale));
    const placedHeight = Math.max(1, Math.round(options.srcH * scale));
    const spareX = Math.max(0, outW - placedWidth);
    const spareY = Math.max(0, outH - placedHeight);
    return renderLetterboxed({
      buffer: options.buffer,
      srcW: options.srcW,
      srcH: options.srcH,
      outW,
      outH,
      placedWidth,
      placedHeight,
      offsetX: Math.floor((spareX * composition.panX) / 100),
      offsetY: Math.floor((spareY * composition.panY) / 100),
      composition,
      destDir: options.destDir,
    });
  }

  if (composition.fit === 'manual') {
    const plan = manualCompositionPlan(
      options.srcW,
      options.srcH,
      outW,
      outH,
      composition,
    );
    if (plan.letterbox) {
      return renderLetterboxed({
        buffer: options.buffer,
        srcW: options.srcW,
        srcH: options.srcH,
        outW,
        outH,
        placedWidth: plan.placedWidth,
        placedHeight: plan.placedHeight,
        offsetX: plan.offsetX,
        offsetY: plan.offsetY,
        composition,
        destDir: options.destDir,
      });
    }
    const extract = plan.extract!;
    const filename = `${uuid()}.webp`;
    const absPath = path.join(options.destDir, filename);
    await (await sharpSource(options.buffer))
      .extract(extract)
      .resize(outW, outH, { fit: 'fill', withoutEnlargement: true })
      .webp({ quality: HOME_MASTER_WEBP_QUALITY, effort: 4 })
      .toFile(absPath);
    return { filename, width: outW, height: outH, absPath };
  }

  // COVER — legacy default
  const crop = coverCropWindow(
    options.srcW,
    options.srcH,
    outW,
    outH,
    { x: composition.panX, y: composition.panY },
  );
  const out = outputSizeForCrop(crop.width, crop.height, outW, outH);
  const filename = `${uuid()}.webp`;
  const absPath = path.join(options.destDir, filename);
  await (await sharpSource(options.buffer))
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    })
    .resize(out.width, out.height, {
      fit: 'fill',
      withoutEnlargement: true,
    })
    .webp({ quality: HOME_MASTER_WEBP_QUALITY, effort: 4 })
    .toFile(absPath);
  return { filename, width: out.width, height: out.height, absPath };
}

async function writeMasterPreview(
  oriented: Buffer,
  destDir: string,
): Promise<{ filename: string; absPath: string }> {
  const filename = `${uuid()}-preview.webp`;
  const absPath = path.join(destDir, filename);
  await sharp(oriented, {
    failOn: 'error',
    limitInputPixels: HOME_MASTER_MAX_PIXELS,
  })
    .resize({
      width: HOME_MASTER_PREVIEW_MAX_EDGE,
      height: HOME_MASTER_PREVIEW_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4 })
    .toFile(absPath);
  return { filename, absPath };
}

async function persistRetainedMaster(options: {
  oriented: Buffer;
  format: HomeRasterFormat;
  mastersDir: string;
}): Promise<{ filename: string; absPath: string; logicalPath: string }> {
  await fs.mkdir(options.mastersDir, { recursive: true });
  const filename = `${uuid()}${homeRasterExt(options.format)}`;
  const absPath = path.join(options.mastersDir, filename);
  // Re-encode via sharp to strip metadata; keep original format family.
  const pipeline = sharp(options.oriented, {
    failOn: 'error',
    limitInputPixels: HOME_MASTER_MAX_PIXELS,
  }).rotate();
  // Avoid mozjpeg — local structural JPEG validators reject some mozjpeg bitstreams,
  // which would break authenticated recrop of retained masters.
  if (options.format === 'jpeg') {
    await pipeline.jpeg({ quality: 92 }).toFile(absPath);
  } else if (options.format === 'png') {
    await pipeline.png({ compressionLevel: 8 }).toFile(absPath);
  } else {
    await pipeline.webp({ quality: 92, effort: 4 }).toFile(absPath);
  }
  return {
    filename,
    absPath,
    logicalPath: `/${HOME_MASTERS_DIR}/${filename}`,
  };
}

/**
 * Process one master raster:
 * - retain verified master under uploads/home-masters (private)
 * - write a public preview under uploads/home for Admin focal UI
 * - write desktop/mobile(+wide) WebP crops under uploads/home
 */
export async function processHomeMasterImage(options: {
  buffer: Buffer;
  outputDir: string;
  mastersDir: string;
  profile: HomeMasterProfile;
  focusDesktop?: FocalPointPercent;
  focusMobile?: FocalPointPercent;
  focusMobileWide?: FocalPointPercent;
  compositionDesktop?: VariantComposition | Record<string, unknown>;
  compositionMobile?: VariantComposition | Record<string, unknown>;
  compositionMobileWide?: VariantComposition | Record<string, unknown>;
  /** When set, skip writing a new retained master (recrop path). */
  existingMasterPath?: string;
}): Promise<HomeMasterProcessResult> {
  const { width, height, format, oriented } = await inspectMasterSource(
    options.buffer,
  );
  const profile = HOME_MASTER_PROFILES[options.profile];
  const focusDesktop = options.focusDesktop || { x: 50, y: 50 };
  const focusMobile = options.focusMobile || focusDesktop;
  const focusMobileWide = options.focusMobileWide || focusMobile;
  const compositionDesktop = parseVariantComposition(
    options.compositionDesktop ?? {
      fit: 'cover',
      panX: focusDesktop.x,
      panY: focusDesktop.y,
    },
  );
  const compositionMobile = parseVariantComposition(
    options.compositionMobile ?? {
      fit: 'cover',
      panX: focusMobile.x,
      panY: focusMobile.y,
    },
  );
  const compositionMobileWide = parseVariantComposition(
    options.compositionMobileWide ?? {
      fit: compositionMobile.fit,
      zoom: compositionMobile.zoom,
      panX: focusMobileWide.x,
      panY: focusMobileWide.y,
      backgroundMode: compositionMobile.backgroundMode,
      backgroundColor: compositionMobile.backgroundColor,
    },
  );

  await fs.mkdir(options.outputDir, { recursive: true });

  const written: string[] = [];
  let retained:
    | { filename: string; absPath: string; logicalPath: string }
    | undefined;

  try {
    if (options.existingMasterPath) {
      const safe = sanitizeHomeMasterPath(options.existingMasterPath);
      if (!safe) throw new Error('INVALID_MASTER_PATH');
      retained = {
        filename: path.basename(safe),
        absPath: resolveHomeMasterAbsolutePath(safe)!,
        logicalPath: safe,
      };
    } else {
      retained = await persistRetainedMaster({
        oriented,
        format,
        mastersDir: options.mastersDir,
      });
      written.push(retained.absPath);
    }

    const preview = await writeMasterPreview(oriented, options.outputDir);
    written.push(preview.absPath);

    const desktop = await renderVariant({
      buffer: oriented,
      srcW: width,
      srcH: height,
      spec: profile.desktop,
      focus: focusDesktop,
      composition: compositionDesktop,
      destDir: options.outputDir,
    });
    written.push(desktop.absPath);

    const mobile = await renderVariant({
      buffer: oriented,
      srcW: width,
      srcH: height,
      spec: profile.mobile,
      focus: focusMobile,
      composition: compositionMobile,
      destDir: options.outputDir,
    });
    written.push(mobile.absPath);

    let mobileWide:
      | { filename: string; width: number; height: number; absPath: string }
      | undefined;
    if (profile.mobileWide) {
      mobileWide = await renderVariant({
        buffer: oriented,
        srcW: width,
        srcH: height,
        spec: profile.mobileWide,
        focus: focusMobileWide,
        composition: compositionMobileWide,
        destDir: options.outputDir,
      });
      written.push(mobileWide.absPath);
    }

    return {
      masterPath: retained.logicalPath,
      masterFilename: retained.filename,
      masterPreviewPath: `/${HOME_OUTPUT_DIR}/${preview.filename}`,
      desktopPath: `/${HOME_OUTPUT_DIR}/${desktop.filename}`,
      mobilePath: `/${HOME_OUTPUT_DIR}/${mobile.filename}`,
      mobileWidePath: mobileWide
        ? `/${HOME_OUTPUT_DIR}/${mobileWide.filename}`
        : undefined,
      desktopFilename: desktop.filename,
      mobileFilename: mobile.filename,
      mobileWideFilename: mobileWide?.filename,
      profile: options.profile,
      desktopWidth: desktop.width,
      desktopHeight: desktop.height,
      mobileWidth: mobile.width,
      mobileHeight: mobile.height,
      mobileWideWidth: mobileWide?.width,
      mobileWideHeight: mobileWide?.height,
    };
  } catch (error) {
    // Keep an existing retained master on recrop failure; only delete new outputs.
    const toDelete = options.existingMasterPath
      ? written.filter((p) => !p.includes(path.sep + HOME_MASTERS_DIR + path.sep))
      : written;
    await Promise.all(toDelete.map((file) => fs.unlink(file).catch(() => undefined)));
    throw error;
  }
}

/**
 * Read a multer temp file, process master variants.
 * Deletes the multer temp (not the retained master).
 */
export async function finalizeHomeMasterUpload(file: {
  path: string;
  destination?: string;
  profile: HomeMasterProfile;
  focusDesktop?: FocalPointPercent;
  focusMobile?: FocalPointPercent;
  focusMobileWide?: FocalPointPercent;
  compositionDesktop?: VariantComposition | Record<string, unknown>;
  compositionMobile?: VariantComposition | Record<string, unknown>;
  compositionMobileWide?: VariantComposition | Record<string, unknown>;
}): Promise<HomeMasterProcessResult> {
  const absPath = path.resolve(file.path);
  const outputDir = path.resolve('./uploads', HOME_OUTPUT_DIR);
  const mastersDir = path.resolve('./uploads', HOME_MASTERS_DIR);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absPath);
  } finally {
    await fs.unlink(absPath).catch(() => undefined);
  }
  return processHomeMasterImage({
    buffer,
    outputDir,
    mastersDir,
    profile: file.profile,
    focusDesktop: file.focusDesktop,
    focusMobile: file.focusMobile,
    focusMobileWide: file.focusMobileWide,
    compositionDesktop: file.compositionDesktop,
    compositionMobile: file.compositionMobile,
    compositionMobileWide: file.compositionMobileWide,
  });
}

/**
 * Recrop from a previously retained master (no re-upload).
 */
export async function recropFromRetainedMaster(options: {
  masterPath: string;
  profile: HomeMasterProfile;
  focusDesktop?: FocalPointPercent;
  focusMobile?: FocalPointPercent;
  focusMobileWide?: FocalPointPercent;
  compositionDesktop?: VariantComposition | Record<string, unknown>;
  compositionMobile?: VariantComposition | Record<string, unknown>;
  compositionMobileWide?: VariantComposition | Record<string, unknown>;
}): Promise<HomeMasterProcessResult> {
  const abs = resolveHomeMasterAbsolutePath(options.masterPath);
  if (!abs) throw new Error('INVALID_MASTER_PATH');
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(abs);
  } catch {
    throw new Error('MASTER_NOT_FOUND');
  }
  return processHomeMasterImage({
    buffer,
    outputDir: path.resolve('./uploads', HOME_OUTPUT_DIR),
    mastersDir: path.resolve('./uploads', HOME_MASTERS_DIR),
    profile: options.profile,
    focusDesktop: options.focusDesktop,
    focusMobile: options.focusMobile,
    focusMobileWide: options.focusMobileWide,
    compositionDesktop: options.compositionDesktop,
    compositionMobile: options.compositionMobile,
    compositionMobileWide: options.compositionMobileWide,
    existingMasterPath: options.masterPath,
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
