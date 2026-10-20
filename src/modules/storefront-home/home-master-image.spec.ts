import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sharp from 'sharp';
import {
  coverCropWindow,
  HOME_MASTER_MAX_BYTES,
  HOME_MASTER_PROFILES,
  inspectMasterSource,
  isHomeMasterProfile,
  outputSizeForCrop,
  parseFocalPoint,
  processHomeMasterImage,
  recropFromRetainedMaster,
  sanitizeHomeMasterPath,
} from './home-master-image';

async function solidJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Gradient so focal crops differ in pixels. */
async function gradientJpeg(width: number, height: number): Promise<Buffer> {
  const { data } = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = Math.floor((x / width) * 255);
      data[i + 1] = Math.floor((y / height) * 255);
      data[i + 2] = 90;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function cleanupDir(dir: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

describe('home-master-image', () => {
  it('recognizes profiles', () => {
    expect(isHomeMasterProfile('hero')).toBe(true);
    expect(isHomeMasterProfile('category')).toBe(true);
    expect(isHomeMasterProfile('pets')).toBe(true);
    expect(isHomeMasterProfile('other')).toBe(false);
  });

  it('parses focal points with clamp', () => {
    expect(parseFocalPoint('12', '88')).toEqual({ x: 12, y: 88 });
    expect(parseFocalPoint(-5, 200)).toEqual({ x: 0, y: 100 });
    expect(parseFocalPoint('x', undefined)).toEqual({ x: 50, y: 50 });
  });

  it('computes cover crop windows without leaving the source', () => {
    const wide = coverCropWindow(2000, 1000, 2400, 1021, { x: 50, y: 50 });
    expect(wide.left).toBeGreaterThanOrEqual(0);
    expect(wide.top).toBeGreaterThanOrEqual(0);
    expect(wide.left + wide.width).toBeLessThanOrEqual(2000);
    expect(wide.top + wide.height).toBeLessThanOrEqual(1000);

    const tall = coverCropWindow(1000, 2000, 1500, 1200, { x: 50, y: 10 });
    expect(tall.left).toBe(0);
    expect(tall.width).toBe(1000);
    expect(tall.top).toBeGreaterThanOrEqual(0);
    expect(tall.top + tall.height).toBeLessThanOrEqual(2000);
  });

  it('avoids upscaling when crop is smaller than target', () => {
    expect(outputSizeForCrop(800, 340, 2400, 1021)).toEqual({
      width: 800,
      height: 340,
    });
    expect(outputSizeForCrop(3000, 1276, 2400, 1021)).toEqual({
      width: 2400,
      height: 1021,
    });
  });

  it('sanitizes retained master paths', () => {
    expect(sanitizeHomeMasterPath('/home-masters/abc.webp')).toBe(
      '/home-masters/abc.webp',
    );
    expect(sanitizeHomeMasterPath('/home/abc.webp')).toBeUndefined();
    expect(sanitizeHomeMasterPath('/home-masters/../etc/passwd')).toBeUndefined();
    expect(sanitizeHomeMasterPath('/home-masters/a/b.webp')).toBeUndefined();
  });

  it('rejects corrupt, svg, and oversized payloads', async () => {
    await expect(inspectMasterSource(Buffer.from('not-an-image'))).rejects.toBeTruthy();
    await expect(
      inspectMasterSource(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).rejects.toBeTruthy();
    const huge = Buffer.alloc(HOME_MASTER_MAX_BYTES + 1, 0xff);
    await expect(inspectMasterSource(huge)).rejects.toBeTruthy();
  });

  it('processes hero into desktop/mobile webp and retains a master', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'home-master-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    try {
      const buffer = await solidJpeg(1800, 1200);
      const result = await processHomeMasterImage({
        buffer,
        outputDir,
        mastersDir,
        profile: 'hero',
        focusDesktop: { x: 40, y: 20 },
        focusMobile: { x: 60, y: 30 },
      });
      expect(result.masterPath).toMatch(/^\/home-masters\/.+/);
      expect(result.masterPreviewPath).toMatch(/^\/home\/.+/);
      expect(result.desktopPath.startsWith('/home/')).toBe(true);
      expect(result.mobilePath.startsWith('/home/')).toBe(true);
      expect(result.desktopPath.endsWith('.webp')).toBe(true);
      expect(result.mobilePath.endsWith('.webp')).toBe(true);
      expect(result.mobileWidePath).toBeUndefined();
      expect(result.desktopWidth).toBeLessThanOrEqual(
        HOME_MASTER_PROFILES.hero.desktop.width,
      );
      expect(result.mobileWidth).toBeLessThanOrEqual(
        HOME_MASTER_PROFILES.hero.mobile.width,
      );

      const deskMeta = await sharp(
        path.join(outputDir, result.desktopFilename),
      ).metadata();
      const mobMeta = await sharp(
        path.join(outputDir, result.mobileFilename),
      ).metadata();
      expect(deskMeta.format).toBe('webp');
      expect(mobMeta.format).toBe('webp');
      await expect(
        fs.access(path.join(mastersDir, result.masterFilename)),
      ).resolves.toBeUndefined();
    } finally {
      await cleanupDir(root);
    }
  });

  it('category profile also emits ≈2.15:1 mobileWide', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'home-master-cat-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    try {
      const result = await processHomeMasterImage({
        buffer: await solidJpeg(2000, 1600),
        outputDir,
        mastersDir,
        profile: 'category',
      });
      expect(result.mobileWidePath).toMatch(/^\/home\/.+\.webp$/);
      expect(result.mobileWideFilename).toBeTruthy();
      const wide = await sharp(
        path.join(outputDir, result.mobileWideFilename!),
      ).metadata();
      expect(wide.format).toBe('webp');
      expect(result.mobileWideWidth).toBeLessThanOrEqual(
        HOME_MASTER_PROFILES.category.mobileWide!.width,
      );
      const aspect =
        (result.mobileWideWidth || 1) / Math.max(1, result.mobileWideHeight || 1);
      expect(aspect).toBeGreaterThan(2.0);
      expect(aspect).toBeLessThan(2.3);
      const normalAspect =
        (result.mobileWidth || 1) / Math.max(1, result.mobileHeight || 1);
      expect(normalAspect).toBeGreaterThan(0.9);
      expect(normalAspect).toBeLessThan(1.2);
    } finally {
      await cleanupDir(root);
    }
  });

  it('pets profile uses wide mobile as primary mobile', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'home-master-pets-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    try {
      const result = await processHomeMasterImage({
        buffer: await solidJpeg(2000, 1200),
        outputDir,
        mastersDir,
        profile: 'pets',
      });
      expect(result.mobileWidePath).toBeUndefined();
      const aspect =
        (result.mobileWidth || 1) / Math.max(1, result.mobileHeight || 1);
      expect(aspect).toBeGreaterThan(2.0);
      expect(aspect).toBeLessThan(2.3);
    } finally {
      await cleanupDir(root);
    }
  });

  it('different focal points produce different crop pixels', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'home-master-focus-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    try {
      const buffer = await gradientJpeg(1600, 1200);
      const left = await processHomeMasterImage({
        buffer,
        outputDir,
        mastersDir,
        profile: 'hero',
        focusDesktop: { x: 10, y: 10 },
        focusMobile: { x: 10, y: 10 },
      });
      const right = await processHomeMasterImage({
        buffer,
        outputDir,
        mastersDir,
        profile: 'hero',
        focusDesktop: { x: 90, y: 90 },
        focusMobile: { x: 90, y: 90 },
      });
      const a = await fs.readFile(path.join(outputDir, left.desktopFilename));
      const b = await fs.readFile(path.join(outputDir, right.desktopFilename));
      expect(Buffer.compare(a, b) === 0).toBe(false);
    } finally {
      await cleanupDir(root);
    }
  });

  it('recropFromRetainedMaster reuses master and changes crops', async () => {
    const uploadsMasters = path.resolve('./uploads', 'home-masters');
    const uploadsHome = path.resolve('./uploads', 'home');
    await fs.mkdir(uploadsMasters, { recursive: true });
    await fs.mkdir(uploadsHome, { recursive: true });
    const written: string[] = [];
    try {
      const first = await processHomeMasterImage({
        buffer: await gradientJpeg(1400, 1000),
        outputDir: uploadsHome,
        mastersDir: uploadsMasters,
        profile: 'hero',
        focusDesktop: { x: 15, y: 20 },
        focusMobile: { x: 15, y: 20 },
      });
      written.push(
        path.join(uploadsMasters, first.masterFilename),
        path.join(uploadsHome, first.desktopFilename),
        path.join(uploadsHome, first.mobileFilename),
        path.join(uploadsHome, path.basename(first.masterPreviewPath)),
      );

      const second = await recropFromRetainedMaster({
        masterPath: first.masterPath,
        profile: 'hero',
        focusDesktop: { x: 85, y: 80 },
        focusMobile: { x: 85, y: 80 },
      });
      written.push(
        path.join(uploadsHome, second.desktopFilename),
        path.join(uploadsHome, second.mobileFilename),
        path.join(uploadsHome, path.basename(second.masterPreviewPath)),
      );

      expect(second.masterPath).toBe(first.masterPath);
      const a = await fs.readFile(path.join(uploadsHome, first.desktopFilename));
      const b = await fs.readFile(path.join(uploadsHome, second.desktopFilename));
      expect(Buffer.compare(a, b) === 0).toBe(false);
      // Original retained master must still exist.
      await expect(
        fs.access(path.join(uploadsMasters, first.masterFilename)),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.all(written.map((f) => fs.unlink(f).catch(() => undefined)));
    }
  });
});

