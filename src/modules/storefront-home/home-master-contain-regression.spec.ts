/**
 * Regression: Mobile Contain must bake the full source into the hero mobile
 * frame (1500×1200). A Cover-sized output (e.g. 1108×887 from withoutEnlargement)
 * means compositionMobile was ignored (stale API) or Cover was applied.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sharp from 'sharp';
import {
  HOME_MASTER_PROFILES,
  processHomeMasterImage,
} from './home-master-image';

async function threeSubjectWide(): Promise<Buffer> {
  const width = 1774;
  const height = 887;
  const { data } = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      if (x < width / 3) {
        data[i] = 220;
        data[i + 1] = 40;
        data[i + 2] = 40;
      } else if (x < (2 * width) / 3) {
        data[i] = 40;
        data[i + 1] = 180;
        data[i + 2] = 60;
      } else {
        data[i] = 40;
        data[i + 1] = 80;
        data[i + 2] = 220;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

function sampleBand(
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
  xRatio: number,
) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(width * xRatio)));
  const y = Math.floor(height / 2);
  const i = (y * width + x) * channels;
  return [raw[i]!, raw[i + 1]!, raw[i + 2]!] as const;
}

async function cleanupDir(dir: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

describe('Mobile Contain regression (three-subject wide master)', () => {
  it('Desktop Cover + Mobile Contain: mobile is full hero frame and keeps all bands', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contain-reg-'));
    const masters = path.join(dir, 'masters');
    const out = path.join(dir, 'out');
    try {
      const buffer = await threeSubjectWide();
      const result = await processHomeMasterImage({
        buffer,
        outputDir: out,
        mastersDir: masters,
        profile: 'hero',
        compositionDesktop: { fit: 'cover', panX: 50, panY: 50 },
        compositionMobile: {
          fit: 'contain',
          panX: 50,
          panY: 50,
          backgroundMode: 'solid',
          backgroundColor: '#101010',
        },
      });

      const heroMobile = HOME_MASTER_PROFILES.hero.mobile;
      expect(result.mobileWidth).toBe(heroMobile.width);
      expect(result.mobileHeight).toBe(heroMobile.height);
      // Cover of this master would be ~1108×887 — must not silently return that.
      expect(result.mobileWidth).toBeGreaterThan(1200);
      expect(result.mobileHeight).toBeGreaterThan(1000);

      const mobileAbs = path.join(out, path.basename(result.mobilePath));
      const deskAbs = path.join(out, path.basename(result.desktopPath));
      const mobileMeta = await sharp(mobileAbs).metadata();
      const deskMeta = await sharp(deskAbs).metadata();
      expect(mobileMeta.width).toBe(heroMobile.width);
      expect(mobileMeta.height).toBe(heroMobile.height);
      expect(deskMeta.width).not.toBe(mobileMeta.width);

      const { data, info } = await sharp(mobileAbs)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const left = sampleBand(data, info.width, info.height, info.channels, 0.12);
      const mid = sampleBand(data, info.width, info.height, info.channels, 0.5);
      const right = sampleBand(data, info.width, info.height, info.channels, 0.88);
      expect(left[0]).toBeGreaterThan(left[2]);
      expect(mid[1]).toBeGreaterThan(mid[0]);
      expect(right[2]).toBeGreaterThan(right[0]);
    } finally {
      await cleanupDir(dir);
    }
  }, 30000);

  it('storefront object-cover of Contain WebP at 400×320 does not drop side bands', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contain-nocrop-'));
    const masters = path.join(dir, 'masters');
    const out = path.join(dir, 'out');
    try {
      const buffer = await threeSubjectWide();
      const result = await processHomeMasterImage({
        buffer,
        outputDir: out,
        mastersDir: masters,
        profile: 'hero',
        compositionMobile: {
          fit: 'contain',
          panX: 50,
          panY: 50,
          backgroundMode: 'solid',
          backgroundColor: '#000000',
        },
        compositionDesktop: { fit: 'cover', panX: 50, panY: 50 },
      });
      const mobileAbs = path.join(out, path.basename(result.mobilePath));
      // Concept D mobile frame at 400px is aspect 5/4 → 400×320; object-cover.
      const { data, info } = await sharp(mobileAbs)
        .resize(400, 320, { fit: 'cover', position: 'centre' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(400);
      expect(info.height).toBe(320);
      const left = sampleBand(data, info.width, info.height, info.channels, 0.12);
      const mid = sampleBand(data, info.width, info.height, info.channels, 0.5);
      const right = sampleBand(data, info.width, info.height, info.channels, 0.88);
      expect(left[0]).toBeGreaterThan(left[2]);
      expect(mid[1]).toBeGreaterThan(mid[0]);
      expect(right[2]).toBeGreaterThan(right[0]);
    } finally {
      await cleanupDir(dir);
    }
  }, 30000);

  it('Cover mobile of the same master is smaller than the Contain hero frame', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-contrast-'));
    const masters = path.join(dir, 'masters');
    const out = path.join(dir, 'out');
    try {
      const buffer = await threeSubjectWide();
      const cover = await processHomeMasterImage({
        buffer,
        outputDir: out,
        mastersDir: masters,
        profile: 'hero',
        compositionMobile: { fit: 'cover', panX: 50, panY: 50 },
        compositionDesktop: { fit: 'cover', panX: 50, panY: 50 },
      });
      const contain = await processHomeMasterImage({
        buffer,
        outputDir: out,
        mastersDir: masters,
        profile: 'hero',
        existingMasterPath: cover.masterPath,
        compositionMobile: {
          fit: 'contain',
          panX: 50,
          panY: 50,
          backgroundMode: 'solid',
          backgroundColor: '#000000',
        },
        compositionDesktop: { fit: 'cover', panX: 50, panY: 50 },
      });
      // Cover withoutEnlargement → source crop window size, not full 1500×1200.
      expect(cover.mobileWidth).toBeLessThan(HOME_MASTER_PROFILES.hero.mobile.width);
      expect(contain.mobileWidth).toBe(HOME_MASTER_PROFILES.hero.mobile.width);
      expect(contain.mobileHeight).toBe(HOME_MASTER_PROFILES.hero.mobile.height);
      const coverBuf = await fs.readFile(
        path.join(out, path.basename(cover.mobilePath)),
      );
      const containBuf = await fs.readFile(
        path.join(out, path.basename(contain.mobilePath)),
      );
      expect(Buffer.compare(coverBuf, containBuf)).not.toBe(0);
    } finally {
      await cleanupDir(dir);
    }
  }, 30000);
});
