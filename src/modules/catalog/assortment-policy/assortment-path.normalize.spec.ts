import {
  isSegmentPrefix,
  normalizePathPrefix,
  normalizePathSegments,
} from './assortment-path.normalize';

describe('assortment path normalization', () => {
  it('normalizes Turkish case safely', () => {
    expect(normalizePathPrefix('Giyim/Fantezi Giyim')).toBe(
      'giyim/fantezi giyim',
    );
    expect(normalizePathPrefix('Ayakkabı')).toBe('ayakkabı');
    // Turkish dotted/dotless I handling via tr locale
    expect(normalizePathSegments('I')[0]).toBe('ı');
    expect(normalizePathSegments('İ')[0]).toBe('i');
  });

  it('normalizes English paths and whitespace', () => {
    expect(normalizePathPrefix('  Clothing / Shoes  ')).toBe('clothing/shoes');
    expect(normalizePathPrefix('Cosmetics & Personal Care')).toBe(
      'cosmetics & personal care',
    );
  });

  it('is segment-safe for prefix matching', () => {
    const path = normalizePathSegments('Giyim/Elbise');
    expect(isSegmentPrefix(path, normalizePathSegments('Giyim'))).toBe(true);
    expect(isSegmentPrefix(path, normalizePathSegments('Giyimm'))).toBe(false);
    expect(isSegmentPrefix(path, normalizePathSegments('Giyim/Elbise/X'))).toBe(
      false,
    );
    expect(isSegmentPrefix(path, [])).toBe(false);
  });

  it('does not treat adjacent letters as a path segment match', () => {
    const path = normalizePathSegments('Ev & Mobilya/MobilyaExtra');
    expect(
      isSegmentPrefix(path, normalizePathSegments('Ev & Mobilya/Mobilya')),
    ).toBe(false);
  });
});
