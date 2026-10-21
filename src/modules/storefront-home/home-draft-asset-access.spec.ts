import {
  appendHomeDraftAssetQuery,
  HOME_DRAFT_ASSET_QUERY,
  signHomeDraftAssetToken,
  verifyHomeDraftAssetToken,
} from './home-draft-asset-access';
import {
  buildPublishedLiveHomePathSet,
  collectLiveHomeImagePathsFromValue,
} from './home-published-live-paths';

describe('home draft asset access', () => {
  const secret = 'unit-test-home-draft-secret';

  it('signs and verifies a path-bound expiring token', () => {
    const token = signHomeDraftAssetToken('/home/a.webp', secret, 600, 1_000_000);
    const claims = verifyHomeDraftAssetToken(
      token,
      secret,
      '/home/a.webp',
      1_000_000,
    );
    expect(claims?.path).toBe('/home/a.webp');
    expect(claims?.exp).toBeGreaterThan(1000);
  });

  it('rejects token for a different filename (not filename secrecy alone)', () => {
    const token = signHomeDraftAssetToken('/home/a.webp', secret, 600, 1_000_000);
    expect(
      verifyHomeDraftAssetToken(token, secret, '/home/b.webp', 1_000_000),
    ).toBeNull();
  });

  it('rejects expired tokens', () => {
    const token = signHomeDraftAssetToken('/home/a.webp', secret, 60, 1_000_000);
    expect(
      verifyHomeDraftAssetToken(token, secret, '/home/a.webp', 1_000_000 + 120_000),
    ).toBeNull();
  });

  it('rejects tampered signatures', () => {
    const token = signHomeDraftAssetToken('/home/a.webp', secret, 600, 1_000_000);
    const [body] = token.split('.');
    expect(
      verifyHomeDraftAssetToken(`${body}.deadbeef`, secret, '/home/a.webp', 1_000_000),
    ).toBeNull();
  });

  it('appends hda query without breaking absolute URLs', () => {
    const url = appendHomeDraftAssetQuery(
      'http://127.0.0.1:9010/static/home/a.webp',
      'tok',
    );
    expect(url).toContain(`${HOME_DRAFT_ASSET_QUERY}=tok`);
    expect(url.startsWith('http://127.0.0.1:9010/static/home/a.webp?')).toBe(
      true,
    );
  });
});

describe('published live home paths', () => {
  it('includes live paths and skips previousImage snapshots', () => {
    const paths = collectLiveHomeImagePathsFromValue({
      desktopImagePath: '/home/live.webp',
      previousImage: {
        desktopImagePath: '/home/snap.webp',
        masterPreviewPath: '/home/snap-preview.webp',
      },
    });
    expect([...paths]).toEqual(['/home/live.webp']);
  });

  it('builds allowlist from section + instance configs', () => {
    const set = buildPublishedLiveHomePathSet({
      sectionConfigs: [
        {
          config: {
            slides: [{ desktopImagePath: '/home/s1.webp' }],
          },
        },
      ],
      instanceConfigs: [
        { config: { imagePath: '/home/i1.webp' } },
      ],
    });
    expect(set.has('/home/s1.webp')).toBe(true);
    expect(set.has('/home/i1.webp')).toBe(true);
  });
});
