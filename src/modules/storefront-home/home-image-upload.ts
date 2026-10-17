import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import {
  isStructurallyValidJpeg,
  isStructurallyValidPng,
  isStructurallyValidWebp,
} from '../manual-payment/utils/receipt-content-validation';

export type HomeRasterFormat = 'jpeg' | 'png' | 'webp';

const EXT_BY_FORMAT: Record<HomeRasterFormat, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
};

const MIME_BY_FORMAT: Record<HomeRasterFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Reject obvious active / non-raster payloads before pixel decode. */
export function looksLikeActiveOrNonRaster(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return true;
  const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').toLowerCase();
  if (head.includes('<svg') || head.includes('<!doctype') || head.includes('<html')) {
    return true;
  }
  if (head.includes('<script') || head.includes('<?php')) return true;
  // GIF / PDF / ZIP / EXE markers
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return true;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return true;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  return false;
}

export async function detectHomeRasterFormat(
  buffer: Buffer,
): Promise<HomeRasterFormat | null> {
  if (looksLikeActiveOrNonRaster(buffer)) return null;
  if (await isStructurallyValidJpeg(buffer)) return 'jpeg';
  if (await isStructurallyValidPng(buffer)) return 'png';
  if (await isStructurallyValidWebp(buffer)) return 'webp';
  return null;
}

export function homeRasterMime(format: HomeRasterFormat): string {
  return MIME_BY_FORMAT[format];
}

export function homeRasterExt(format: HomeRasterFormat): string {
  return EXT_BY_FORMAT[format];
}

/**
 * Verify multer disk file contents, rename to uuid + verified extension,
 * and delete the original when the extension was wrong or unsafe.
 */
export async function finalizeVerifiedHomeUpload(file: {
  path: string;
  filename: string;
  destination?: string;
}): Promise<{ filename: string; format: HomeRasterFormat }> {
  const absPath = path.resolve(file.path);
  const buffer = await fs.readFile(absPath);
  const format = await detectHomeRasterFormat(buffer);
  if (!format) {
    await fs.unlink(absPath).catch(() => undefined);
    throw new Error('INVALID_HOME_IMAGE');
  }

  const destDir = file.destination
    ? path.resolve(file.destination)
    : path.dirname(absPath);
  const nextName = `${uuid()}${homeRasterExt(format)}`;
  const nextAbs = path.join(destDir, nextName);

  if (path.basename(absPath) !== nextName) {
    await fs.rename(absPath, nextAbs);
  }

  return { filename: nextName, format };
}
