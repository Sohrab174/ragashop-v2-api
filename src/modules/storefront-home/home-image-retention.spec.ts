import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildHomeImageReferenceMap,
  collectHomeImagePathsFromValue,
  evaluateHomeImageRetention,
  listHomeImageDiskFiles,
} from './home-image-retention';

describe('home-image-retention', () => {
  it('collects live paths and nested previousImage masters', () => {
    const paths = collectHomeImagePathsFromValue({
      chapters: [
        {
          desktopImagePath: '/home/desk.webp',
          mobileWideImagePath: '/home/wide.webp',
          masterImagePath: '/home-masters/m1.jpg',
          masterPreviewPath: '/home/prev.webp',
          previousImage: {
            desktopImagePath: '/home/old-desk.webp',
            masterImagePath: '/home-masters/old-m.jpg',
            mobileWideImagePath: '/home/old-wide.webp',
          },
        },
      ],
      logoPath: '/home/brand.webp',
      imageUrl: 'http://127.0.0.1:9010/static/home/from-url.webp',
    });
    expect(paths.has('/home/desk.webp')).toBe(true);
    expect(paths.has('/home/wide.webp')).toBe(true);
    expect(paths.has('/home-masters/m1.jpg')).toBe(true);
    expect(paths.has('/home/prev.webp')).toBe(true);
    expect(paths.has('/home/old-desk.webp')).toBe(true);
    expect(paths.has('/home-masters/old-m.jpg')).toBe(true);
    expect(paths.has('/home/old-wide.webp')).toBe(true);
    expect(paths.has('/home/brand.webp')).toBe(true);
    expect(paths.has('/home/from-url.webp')).toBe(true);
    expect(paths.has('/home/../etc/passwd')).toBe(false);
  });

  it('never marks referenced files as deletion candidates', () => {
    const references = buildHomeImageReferenceMap({
      sectionConfigs: [
        {
          key: 'category_chapters',
          config: {
            chapters: [
              {
                desktopImagePath: '/home/live.webp',
                previousImage: { desktopImagePath: '/home/snap.webp' },
              },
            ],
          },
        },
      ],
      previewSessionPayloads: [
        {
          payload: {
            sections: [
              { hero: { desktopImageUrl: '/static/home/preview-only.webp' } },
            ],
          },
        },
      ],
    });

    const now = Date.now();
    const report = evaluateHomeImageRetention({
      nowMs: now,
      graceMs: 60_000,
      references,
      diskFiles: [
        {
          logicalPath: '/home/live.webp',
          absPath: '/tmp/live.webp',
          sizeBytes: 10,
          mtimeMs: now - 86_400_000,
        },
        {
          logicalPath: '/home/snap.webp',
          absPath: '/tmp/snap.webp',
          sizeBytes: 10,
          mtimeMs: now - 86_400_000,
        },
        {
          logicalPath: '/home/preview-only.webp',
          absPath: '/tmp/preview-only.webp',
          sizeBytes: 10,
          mtimeMs: now - 86_400_000,
        },
        {
          logicalPath: '/home/orphan-old.webp',
          absPath: '/tmp/orphan-old.webp',
          sizeBytes: 10,
          mtimeMs: now - 86_400_000,
        },
        {
          logicalPath: '/home/orphan-new.webp',
          absPath: '/tmp/orphan-new.webp',
          sizeBytes: 10,
          mtimeMs: now - 1_000,
        },
      ],
    });

    expect(report.dryRun).toBe(true);
    expect(report.deletionEnabled).toBe(false);
    expect(
      report.referenced.map((r) => r.logicalPath).sort(),
    ).toEqual(
      ['/home/live.webp', '/home/preview-only.webp', '/home/snap.webp'].sort(),
    );
    expect(report.graceProtected.map((r) => r.logicalPath)).toEqual([
      '/home/orphan-new.webp',
    ]);
    expect(report.deletionCandidates.map((r) => r.logicalPath)).toEqual([
      '/home/orphan-old.webp',
    ]);
    expect(
      report.referenced.every((r) => r.wouldDeleteIfEnabled === false),
    ).toBe(true);
    expect(
      report.graceProtected.every((r) => r.wouldDeleteIfEnabled === false),
    ).toBe(true);
  });

  it('lists only safe filenames under home and home-masters', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'home-ret-'));
    try {
      await fs.mkdir(path.join(root, 'home'), { recursive: true });
      await fs.mkdir(path.join(root, 'home-masters'), { recursive: true });
      await fs.writeFile(path.join(root, 'home', 'a.webp'), 'x');
      await fs.writeFile(path.join(root, 'home-masters', 'b.jpg'), 'y');
      await fs.writeFile(path.join(root, 'home', '..evil'), 'z').catch(() => undefined);
      const files = await listHomeImageDiskFiles(root);
      const paths = files.map((f) => f.logicalPath).sort();
      expect(paths).toEqual(['/home-masters/b.jpg', '/home/a.webp']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
