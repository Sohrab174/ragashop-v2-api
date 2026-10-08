import { buildCoverageV2Summary } from './cat-map-v2c-coverage';
import { emptyDistribution } from './cat-map-v2a-classification';

describe('CAT-MAP-V2-C coverage metrics', () => {
  it('does not claim V2 complete from legacy unreviewed sources', () => {
    const summary = buildCoverageV2Summary({
      discoverableCatalogProducts: 10000,
      currentlyDiscoverableViaActiveScopes: 8000,
      v2RoutedFemale: 0,
      v2RoutedMale: 0,
      v2RoutedUnisexViaAdultSlices: 0,
      unresolvedUnknownGenderInAdultMappedScopes: 400,
      sourceRows: [
        {
          sourceCategoryId: 1,
          routingStatus: 'UNREVIEWED',
          classification: 'MIXED_REVIEW_REQUIRED',
          discoverable: {
            total: 7729,
            female: 4625,
            male: 2661,
            unisex: 39,
            unknown: 404,
          },
          rules: [],
        },
        {
          sourceCategoryId: 2,
          routingStatus: 'COMPLETE',
          classification: 'SAFE_SINGLE_AUDIENCE',
          discoverable: {
            total: 100,
            female: 100,
            male: 0,
            unisex: 0,
            unknown: 0,
          },
          rules: [],
        },
        {
          sourceCategoryId: 3,
          routingStatus: 'PARTIAL',
          classification: 'MIXED_REVIEW_REQUIRED',
          discoverable: {
            total: 200,
            female: 120,
            male: 80,
            unisex: 0,
            unknown: 0,
          },
          rules: [],
        },
        {
          sourceCategoryId: 4,
          routingStatus: 'UNMAPPED',
          classification: 'UNKNOWN',
          discoverable: { total: 5, female: 0, male: 0, unisex: 0, unknown: 5 },
          rules: [],
        },
      ],
    });

    expect(summary.sourceCategories.legacyUnreviewed).toBe(1);
    expect(summary.sourceCategories.fullyRouted).toBe(1);
    expect(summary.sourceCategories.partiallyRouted).toBe(1);
    expect(summary.sourceCategories.needingReview).toBe(2); // MIXED unreviewed + PARTIAL
    expect(summary.sourceCategories.unmappedWithDiscoverableProducts).toBe(1);
    expect(summary.products.v2AdultGenderRoutedUnion).toBe(0);
    expect(summary.products.currentlyDiscoverableViaActiveScopes).toBe(8000);
    expect(summary.products.discoverableCatalogProducts).toBe(10000);
  });

  it('union does not double-count unisex', () => {
    const summary = buildCoverageV2Summary({
      discoverableCatalogProducts: 1000,
      currentlyDiscoverableViaActiveScopes: 900,
      v2RoutedFemale: 400,
      v2RoutedMale: 300,
      v2RoutedUnisexViaAdultSlices: 50,
      unresolvedUnknownGenderInAdultMappedScopes: 10,
      sourceRows: [],
    });
    expect(summary.products.v2AdultGenderRoutedUnion).toBe(750);
    expect(summary.denominators.v2AdultGenderRoutedUnion).toMatch(
      /not double-counted/i,
    );
  });

  it('empty source rows stay zeroed', () => {
    const summary = buildCoverageV2Summary({
      discoverableCatalogProducts: 0,
      currentlyDiscoverableViaActiveScopes: 0,
      v2RoutedFemale: 0,
      v2RoutedMale: 0,
      v2RoutedUnisexViaAdultSlices: 0,
      unresolvedUnknownGenderInAdultMappedScopes: 0,
      sourceRows: [
        {
          sourceCategoryId: 9,
          routingStatus: 'UNMAPPED',
          classification: 'UNKNOWN',
          discoverable: emptyDistribution(),
          rules: [],
        },
      ],
    });
    expect(summary.sourceCategories.unmappedWithDiscoverableProducts).toBe(0);
  });
});
