import { effectiveMobileImagePath } from './effective-home-mobile-image';

describe('effectiveMobileImagePath', () => {
  it('prefers override over generated and legacy', () => {
    expect(
      effectiveMobileImagePath({
        desktopImagePath: '/home/d.webp',
        mobileImagePath: '/home/legacy.webp',
        generatedMobileImagePath: '/home/g.webp',
        mobileImageOverridePath: '/home/o.webp',
      }),
    ).toBe('/home/o.webp');
  });

  it('falls back generated then legacy then desktop', () => {
    expect(
      effectiveMobileImagePath({
        desktopImagePath: '/home/d.webp',
        generatedMobileImagePath: '/home/g.webp',
        mobileImagePath: '/home/legacy.webp',
      }),
    ).toBe('/home/g.webp');
    expect(
      effectiveMobileImagePath({
        desktopImagePath: '/home/d.webp',
        mobileImagePath: '/home/legacy.webp',
      }),
    ).toBe('/home/legacy.webp');
    expect(effectiveMobileImagePath({ desktopImagePath: '/home/d.webp' })).toBe(
      '/home/d.webp',
    );
  });

  it('keeps published legacy mobileImagePath compatible', () => {
    expect(
      effectiveMobileImagePath({ mobileImagePath: '/home/only-legacy.webp' }),
    ).toBe('/home/only-legacy.webp');
  });
});
