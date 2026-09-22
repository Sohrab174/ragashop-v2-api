import {
  buildCanonicalBreadcrumbTrail,
  compactBreadcrumbTrail,
} from './storefront-pdp.breadcrumb';
import {
  collectSameSourceAncestorIds,
  isEligiblePdpSiblingCandidate,
  normalizePdpSourceKey,
  resolvePdpBreadcrumbRequiredSource,
  siblingSharesAuthoritativeSource,
  type SourceCategoryAncestorRow,
} from './storefront-pdp.source-isolation';

function catMap(
  rows: SourceCategoryAncestorRow[],
): Map<number, SourceCategoryAncestorRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

describe('storefront-pdp.source-isolation — breadcrumb (PDP1-I1A)', () => {
  it('A. same-source parent chain continues and preserves canonical trail', () => {
    const byId = catMap([
      { id: 30, parentId: 20, source: 'trendyol' },
      { id: 20, parentId: 10, source: 'trendyol' },
      { id: 10, parentId: 1, source: 'trendyol' },
    ]);
    const required = resolvePdpBreadcrumbRequiredSource('trendyol', 'trendyol');
    const ancestors = collectSameSourceAncestorIds(30, byId, required);
    expect(ancestors).toEqual([30, 20, 10]);

    // Mapping only on mid ancestor → nearest mapped wins for trail root.
    const mappingBySource = new Map<number, number>([
      [20, 200],
      [10, 100],
    ]);
    let canonicalId: number | null = null;
    for (const id of ancestors) {
      const hit = mappingBySource.get(id);
      if (hit) {
        canonicalId = hit;
        break;
      }
    }
    expect(canonicalId).toBe(200);
    if (canonicalId == null) {
      throw new Error('expected mapped canonical id');
    }

    const canonicalById = new Map([
      [
        100,
        { id: 100, parentId: null, name: 'Root', status: 'active' as const },
      ],
      [
        200,
        {
          id: 200,
          parentId: 100,
          name: 'Apparel',
          status: 'active' as const,
        },
      ],
    ]);
    const trail = compactBreadcrumbTrail(
      buildCanonicalBreadcrumbTrail(canonicalId, canonicalById),
      3,
    );
    expect(trail.map((t) => t.name)).toEqual(['Root', 'Apparel']);
  });

  it('B. cross-source parent stops before foreign ancestor (no mapping leak)', () => {
    const byId = catMap([
      { id: 30, parentId: 20, source: 'trendyol' },
      { id: 20, parentId: 99, source: 'trendyol' },
      // Foreign parent — must not enter ancestor set.
      { id: 99, parentId: 1, source: 'hepsiburada' },
    ]);
    const required = normalizePdpSourceKey('trendyol');
    const ancestors = collectSameSourceAncestorIds(30, byId, required);
    expect(ancestors).toEqual([30, 20]);
    expect(ancestors).not.toContain(99);

    const mappingBySource = new Map<number, number>([
      [99, 999], // would leak if traversal crossed
      [20, 200],
    ]);
    const reachableCanonical = ancestors
      .map((id) => mappingBySource.get(id))
      .filter((v): v is number => v != null);
    expect(reachableCanonical).toEqual([200]);
    expect(reachableCanonical).not.toContain(999);
  });

  it('C. null-source parent stops traversal (no boundary crossing)', () => {
    const byId = catMap([
      { id: 30, parentId: 20, source: 'trendyol' },
      { id: 20, parentId: 10, source: null },
      { id: 10, parentId: 1, source: 'trendyol' },
    ]);
    const required = normalizePdpSourceKey('trendyol');
    const ancestors = collectSameSourceAncestorIds(30, byId, required);
    expect(ancestors).toEqual([30]);
    expect(ancestors).not.toContain(20);
    expect(ancestors).not.toContain(10);
  });

  it('empty required source includes start only', () => {
    const byId = catMap([
      { id: 30, parentId: 20, source: null },
      { id: 20, parentId: 1, source: 'trendyol' },
    ]);
    const ancestors = collectSameSourceAncestorIds(30, byId, null);
    expect(ancestors).toEqual([30]);
  });

  it('prefers product source over start category source', () => {
    expect(resolvePdpBreadcrumbRequiredSource('trendyol', 'hepsiburada')).toBe(
      'trendyol',
    );
    expect(resolvePdpBreadcrumbRequiredSource(null, 'hepsiburada')).toBe(
      'hepsiburada',
    );
  });
});

describe('storefront-pdp.source-isolation — siblings (PDP1-I1B)', () => {
  const current = {
    id: 1,
    source: 'trendyol',
    sourceGroupId: 'SAME-GROUP',
    status: 'active',
    isDeleted: false,
    price: 100,
    categoryId: 50,
  };

  it('D. same sourceGroupId + same source is allowed', () => {
    expect(
      isEligiblePdpSiblingCandidate(current, {
        ...current,
        id: 2,
        source: 'trendyol',
        sourceGroupId: 'SAME-GROUP',
      }),
    ).toBe(true);
  });

  it('D. reused sourceGroupId across sources is rejected', () => {
    expect(
      isEligiblePdpSiblingCandidate(current, {
        ...current,
        id: 3,
        source: 'another-retailer',
        sourceGroupId: 'SAME-GROUP',
      }),
    ).toBe(false);
    expect(
      siblingSharesAuthoritativeSource('trendyol', 'another-retailer'),
    ).toBe(false);
  });

  it('E. inactive / deleted / technical-category / invalid price remain ineligible', () => {
    expect(
      isEligiblePdpSiblingCandidate(current, {
        ...current,
        id: 4,
        status: 'inactive',
      }),
    ).toBe(false);
    expect(
      isEligiblePdpSiblingCandidate(current, {
        ...current,
        id: 5,
        isDeleted: true,
      }),
    ).toBe(false);
    expect(
      isEligiblePdpSiblingCandidate(current, {
        ...current,
        id: 6,
        categoryId: 1,
      }),
    ).toBe(false);
    expect(
      isEligiblePdpSiblingCandidate(current, {
        ...current,
        id: 7,
        price: 0,
      }),
    ).toBe(false);
  });

  it('excludes current product and empty source/group', () => {
    expect(isEligiblePdpSiblingCandidate(current, current)).toBe(false);
    expect(
      isEligiblePdpSiblingCandidate(
        { ...current, source: null },
        { ...current, id: 8 },
      ),
    ).toBe(false);
    expect(
      isEligiblePdpSiblingCandidate(
        { ...current, sourceGroupId: '  ' },
        { ...current, id: 9 },
      ),
    ).toBe(false);
  });
});
