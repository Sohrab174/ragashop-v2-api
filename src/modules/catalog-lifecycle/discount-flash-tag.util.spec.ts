import {
  earliestFlashWindowEnd,
  extractFlashTagsFromQuery,
  parseFlashSaleTag,
} from './discount-flash-tag.util';

describe('discount flash tag util', () => {
  it('parses fs_DD_MM_YYYY_start_end tags', () => {
    const w = parseFlashSaleTag('fs_15_11_2026_0_24');
    expect(w).not.toBeNull();
    expect(w!.end.getTime()).toBeGreaterThan(w!.start.getTime());
  });

  it('rejects invalid tags', () => {
    expect(parseFlashSaleTag('flash-sale')).toBeNull();
    expect(parseFlashSaleTag('fs_15_11_2026_24_0')).toBeNull();
  });

  it('extracts tags from query and picks earliest future end', () => {
    const tags = extractFlashTagsFromQuery(
      'fs_15_11_2026_21_24,fs_15_11_2026_0_24',
    );
    expect(tags).toHaveLength(2);
    // Relative to a time inside 15 Nov 2026 TR morning
    const now = new Date('2026-11-15T06:00:00.000Z'); // 09:00 TR
    const end = earliestFlashWindowEnd(tags, now);
    expect(end).not.toBeNull();
  });
});
