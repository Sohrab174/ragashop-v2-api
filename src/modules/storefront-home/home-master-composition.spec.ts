import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sharp from 'sharp';
import {
  containScale,
  coverCropWindow,
  coverScale,
  defaultVariantComposition,
  manualCompositionPlan,
  parseVariantComposition,
} from './home-master-composition';
import {
  HOME_MASTER_PROFILES,
  processHomeMasterImage,
} from './home-master-image';

/** Wide gradient with three colored vertical bands (left/mid/right subjects). */
async function threeSubjectWide(): Promise<Buffer> {
  const width = 2400;
  const height = 900;
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
    .jpeg({ quality: 90 })
    .toBuffer();
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

describe('home-master-composition', () => {
  it('defaults to cover and clamps composition fields', () => {
    expect(defaultVariantComposition().fit).toBe('cover');
    const parsed = parseVariantComposition({
      fit: 'manual',
      zoom: 99,
      panX: -10,
      panY: 200,
      backgroundMode: 'solid',
      backgroundColor: '#abc',
    });
    expect(parsed.fit).toBe('manual');
    expect(parsed.zoom).toBe(4);
    expect(parsed.panX).toBe(0);
    expect(parsed.panY).toBe(100);
    expect(parsed.backgroundMode).toBe('solid');
    expect(parsed.backgroundColor).toBe('#aabbcc');
  });

  it('cover crop stays inside the source', () => {
    const crop = coverCropWindow(2000, 1000, 1500, 1200, 50, 50);
    expect(crop.left).toBeGreaterThanOrEqual(0);
    expect(crop.top).toBeGreaterThanOrEqual(0);
    expect(crop.left + crop.width).toBeLessThanOrEqual(2000);
    expect(crop.top + crop.height).toBeLessThanOrEqual(1000);
  });

  it('manual zoom=1 letterboxes a wide image into a tall mobile frame', () => {
    const mobile = HOME_MASTER_PROFILES.hero.mobile;
    const plan = manualCompositionPlan(
      2400,
      900,
      mobile.width,
      mobile.height,
      defaultVariantComposition({ fit: 'manual', zoom: 1 }),
    );
    expect(plan.letterbox).toBe(true);
    expect(plan.extract).toBeNull();
    expect(plan.placedWidth).toBeLessThanOrEqual(mobile.width);
    expect(plan.placedHeight).toBeLessThanOrEqual(mobile.height);
    expect(containScale(2400, 900, mobile.width, mobile.height)).toBeLessThan(
      coverScale(2400, 900, mobile.width, mobile.height),
    );
  });

  it('manual high zoom extracts a crop window', () => {
    const mobile = HOME_MASTER_PROFILES.hero.mobile;
    const plan = manualCompositionPlan(
      2400,
      900,
      mobile.width,
      mobile.height,
      defaultVariantComposition({ fit: 'manual', zoom: 4, panX: 10, panY: 50 }),
    );
    expect(plan.letterbox).toBe(false);
    expect(plan.extract).toBeTruthy();
    expect(plan.extract!.left).toBeGreaterThanOrEqual(0);
    expect(plan.extract!.left + plan.extract!.width).toBeLessThanOrEqual(2400);
  });

  it('contain keeps all three color bands visible on hero mobile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comp-contain-'));
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
          zoom: 1,
          panX: 50,
          panY: 50,
          backgroundMode: 'solid',
          backgroundColor: '#101010',
        },
      });
      const mobileAbs = path.join(out, path.basename(result.mobilePath));
      const { data, info } = await sharp(mobileAbs)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(result.mobileWidth);
      expect(info.height).toBe(result.mobileHeight);

      const sample = (x: number, y: number) => {
        const i = (y * info.width + x) * info.channels;
        return [data[i], data[i + 1], data[i + 2]] as const;
      };
      // Mid-row: left third red-ish, center green-ish, right blue-ish.
      const midY = Math.floor(info.height / 2);
      const left = sample(Math.floor(info.width * 0.12), midY);
      const mid = sample(Math.floor(info.width * 0.5), midY);
      const right = sample(Math.floor(info.width * 0.88), midY);
      expect(left[0]).toBeGreaterThan(left[2]);
      expect(mid[1]).toBeGreaterThan(mid[0]);
      expect(right[2]).toBeGreaterThan(right[0]);
    } finally {
      await cleanupDir(dir);
    }
  }, 30000);

  it('cover and contain produce different mobile outputs for the same master', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comp-modes-'));
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
      });
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
