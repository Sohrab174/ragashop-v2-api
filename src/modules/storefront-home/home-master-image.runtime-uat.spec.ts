/**
 * Runtime UAT for master image processing — no HTTP auth / no secrets.
 * Exercises real Sharp pipeline with disposable temp files.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sharp from 'sharp';
import {
  HOME_MASTER_PROFILES,
  processHomeMasterImage,
  recropFromRetainedMaster,
} from './home-master-image';

async function makeRaster(
  format: 'jpeg' | 'png' | 'webp',
  width = 2000,
  height = 1400,
): Promise<Buffer> {
  const img = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 40, b: 60 },
    },
  });
  if (format === 'jpeg') return img.jpeg({ quality: 85 }).toBuffer();
  if (format === 'png') return img.png().toBuffer();
  return img.webp({ quality: 85 }).toBuffer();
}

async function cleanupDir(dir: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

describe('home-master-image runtime UAT', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'processes %s master into desktop+mobile webp (hero)',
    async (format) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `uat-hero-${format}-`));
      const outputDir = path.join(root, 'home');
      const mastersDir = path.join(root, 'home-masters');
      try {
        const result = await processHomeMasterImage({
          buffer: await makeRaster(format),
          outputDir,
          mastersDir,
          profile: 'hero',
          focusDesktop: { x: 30, y: 20 },
          focusMobile: { x: 70, y: 40 },
        });
        expect(result.masterPath).toMatch(/^\/home-masters\//);
        expect(result.desktopPath).toMatch(/^\/home\/[a-f0-9-]+\.webp$/i);
        expect(result.mobilePath).toMatch(/^\/home\/[a-f0-9-]+\.webp$/i);
        expect(result.desktopWidth).toBeLessThanOrEqual(
          HOME_MASTER_PROFILES.hero.desktop.width,
        );
        expect(result.mobileWidth).toBeLessThanOrEqual(
          HOME_MASTER_PROFILES.hero.mobile.width,
        );
        const desk = await sharp(
          path.join(outputDir, result.desktopFilename),
        ).metadata();
        const mob = await sharp(
          path.join(outputDir, result.mobileFilename),
        ).metadata();
        expect(desk.format).toBe('webp');
        expect(mob.format).toBe('webp');
        expect(desk.width! / desk.height!).toBeCloseTo(2.35, 1);
        expect(mob.width! / mob.height!).toBeCloseTo(1.25, 1);
      } finally {
        await cleanupDir(root);
      }
    },
  );

  it('processes category profile with normal + wide mobile', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uat-category-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    try {
      const result = await processHomeMasterImage({
        buffer: await makeRaster('jpeg', 1600, 1600),
        outputDir,
        mastersDir,
        profile: 'category',
      });
      const desk = await sharp(
        path.join(outputDir, result.desktopFilename),
      ).metadata();
      const mob = await sharp(
        path.join(outputDir, result.mobileFilename),
      ).metadata();
      const wide = await sharp(
        path.join(outputDir, result.mobileWideFilename!),
      ).metadata();
      expect(desk.width! / desk.height!).toBeCloseTo(1.2, 1);
      expect(mob.width! / mob.height!).toBeCloseTo(1.05, 1);
      expect(wide.width! / wide.height!).toBeCloseTo(2.15, 1);
    } finally {
      await cleanupDir(root);
    }
  });

  it('processes pets profile wide mobile', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uat-pets-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    try {
      const result = await processHomeMasterImage({
        buffer: await makeRaster('png', 2400, 1200),
        outputDir,
        mastersDir,
        profile: 'pets',
      });
      const mob = await sharp(
        path.join(outputDir, result.mobileFilename),
      ).metadata();
      expect(mob.width! / mob.height!).toBeCloseTo(2.15, 1);
    } finally {
      await cleanupDir(root);
    }
  });

  it('rejects svg and corrupt payloads without leftover outputs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uat-reject-'));
    const outputDir = path.join(root, 'home');
    const mastersDir = path.join(root, 'home-masters');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(mastersDir, { recursive: true });
    try {
      await expect(
        processHomeMasterImage({
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
          outputDir,
          mastersDir,
          profile: 'hero',
        }),
      ).rejects.toBeTruthy();
      await expect(
        processHomeMasterImage({
          buffer: Buffer.from('not-an-image'),
          outputDir,
          mastersDir,
          profile: 'hero',
        }),
      ).rejects.toBeTruthy();
      expect(await fs.readdir(outputDir)).toEqual([]);
      expect(await fs.readdir(mastersDir)).toEqual([]);
    } finally {
      await cleanupDir(root);
    }
  });

  it('recrop from uploads retains master path', async () => {
    const uploadsMasters = path.resolve('./uploads', 'home-masters');
    const uploadsHome = path.resolve('./uploads', 'home');
    await fs.mkdir(uploadsMasters, { recursive: true });
    await fs.mkdir(uploadsHome, { recursive: true });
    const written: string[] = [];
    try {
      const first = await processHomeMasterImage({
        buffer: await makeRaster('jpeg', 1200, 900),
        outputDir: uploadsHome,
        mastersDir: uploadsMasters,
        profile: 'hero',
        focusDesktop: { x: 20, y: 20 },
        focusMobile: { x: 20, y: 20 },
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
        focusDesktop: { x: 80, y: 80 },
        focusMobile: { x: 80, y: 80 },
      });
      written.push(
        path.join(uploadsHome, second.desktopFilename),
        path.join(uploadsHome, second.mobileFilename),
        path.join(uploadsHome, path.basename(second.masterPreviewPath)),
      );
      expect(second.masterPath).toBe(first.masterPath);
      expect(second.desktopPath).not.toBe(first.desktopPath);
    } finally {
      await Promise.all(written.map((f) => fs.unlink(f).catch(() => undefined)));
    }
  });
});
