import {
  boundedLevenshtein,
  escapeLikePattern,
  lightTypoMatch,
  normalizePersianArabicLetters,
  normalizeSearchQuery,
  normalizeSearchText,
  SEARCH_MAX_QUERY_LENGTH,
} from './search-normalize';
import { SEARCH_RANKING_WEIGHTS } from './search-ranking';
import { parseStorefrontSearchQuery } from './storefront-search.query';
import { evaluateDiscoveryEligibility } from '../product/discovery-eligibility';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import { SourceCommercialAvailability } from '../source-availability';
import { BRAND_ALIAS_DEFAULTS } from './brand-alias.defaults';
import {
  SUGGESTION_MAX_RESULTS,
  SUGGESTION_MIN_PRODUCT_QUERY_LENGTH,
  SUGGESTION_RANKING_WEIGHTS,
} from './suggestion-ranking';
import { parseStorefrontSuggestionQuery } from './storefront-suggestion.query';

describe('Search V1 normalization', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSearchText('  کفش   نایک  ')).toBe('کفش نایک');
  });

  it('lowercases Latin only', () => {
    expect(normalizeSearchText('NiKe Shoes')).toBe('nike shoes');
  });

  it('normalizes Arabic Yeh/Kaf to Persian', () => {
    expect(normalizePersianArabicLetters('نايك')).toBe('نایک');
    expect(normalizeSearchText('كفش')).toBe('کفش');
  });

  it('preserves digits / model-like tokens', () => {
    const q = normalizeSearchQuery('Air Force 1');
    expect(q.tokens).toEqual(expect.arrayContaining(['air', 'force', '1']));
  });

  it('handles mixed Persian/English', () => {
    const q = normalizeSearchQuery('کفش Nike');
    expect(q.normalized).toBe('کفش nike');
    expect(q.tokens).toEqual(['کفش', 'nike']);
  });

  it('bounds excessive query length at normalize boundary', () => {
    const long = 'a'.repeat(SEARCH_MAX_QUERY_LENGTH + 40);
    const q = normalizeSearchQuery(long);
    expect(q.raw.length).toBe(SEARCH_MAX_QUERY_LENGTH);
  });
});

describe('Search V1 light typo tolerance', () => {
  it('matches one Latin typo against alias set only', () => {
    expect(lightTypoMatch('adiddas', ['adidas', 'nike'])).toBe('adidas');
    expect(lightTypoMatch('nik', ['nike', 'adidas'])).toBe('nike');
  });

  it('matches light Persian near-miss', () => {
    expect(lightTypoMatch('نایکی', ['نایک', 'آدیداس'])).toBe('نایک');
  });

  it('does not turn unrelated queries into broad noise', () => {
    expect(lightTypoMatch('xyzabc', ['nike', 'adidas'])).toBeNull();
    expect(boundedLevenshtein('shoes', 'nike', 1)).toBeGreaterThan(1);
  });
});

describe('Search V1 brand alias data', () => {
  it('keeps Nike/Adidas aliases data-driven (not in ranking weights)', () => {
    const nike = BRAND_ALIAS_DEFAULTS.find((g) => g.key === 'nike');
    const adidas = BRAND_ALIAS_DEFAULTS.find((g) => g.key === 'adidas');
    expect(nike?.aliases).toEqual(
      expect.arrayContaining(['Nike', 'nike', 'نایک', 'نایکی']),
    );
    expect(adidas?.aliases).toEqual(
      expect.arrayContaining(['Adidas', 'آدیداس']),
    );
    expect(JSON.stringify(SEARCH_RANKING_WEIGHTS)).not.toMatch(/nike|نایک/i);
  });
});

describe('Search V1 query validation', () => {
  it('requires q and bounds pagination', () => {
    expect(parseStorefrontSearchQuery({}).ok).toBe(false);
    expect(parseStorefrontSearchQuery({ q: '   ' }).ok).toBe(false);
    expect(
      parseStorefrontSearchQuery({
        q: 'a'.repeat(SEARCH_MAX_QUERY_LENGTH + 1),
      }).ok,
    ).toBe(false);
    expect(parseStorefrontSearchQuery({ q: 'نایک', page: '0' }).ok).toBe(false);
    expect(parseStorefrontSearchQuery({ q: 'نایک', limit: '99' }).ok).toBe(
      false,
    );
  });

  it('defaults sort to relevance and accepts commercial sorts', () => {
    const rel = parseStorefrontSearchQuery({ q: 'nike' });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.value.sort).toBe('relevance');

    const price = parseStorefrontSearchQuery({
      q: 'nike',
      sort: 'price_asc',
    });
    expect(price.ok).toBe(true);
    if (price.ok) expect(price.value.sort).toBe('price_asc');
  });

  it('escapes LIKE wildcards from user input', () => {
    expect(escapeLikePattern('100%_off')).toBe('100\\%\\_off');
  });
});

describe('Search V1 discovery policy reuse (A4)', () => {
  it('curated eligible external appears', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.external_source,
        isCuratedExternalCatalog: true,
        sourceAvailability: SourceCommercialAvailability.available,
      }).eligible,
    ).toBe(true);
  });

  it('curated UNAVAILABLE / REMOVED do not appear', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.external_source,
        isCuratedExternalCatalog: true,
        sourceAvailability: SourceCommercialAvailability.unavailable,
      }).eligible,
    ).toBe(false);
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.external_source,
        isCuratedExternalCatalog: true,
        sourceAvailability: SourceCommercialAvailability.removed,
      }).eligible,
    ).toBe(false);
  });

  it('non-curated paste-link external does not enter normal search', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.external_source,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.available,
      }).eligible,
    ).toBe(false);
  });

  it('UNKNOWN remains discoverable for curated external', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.external_source,
        isCuratedExternalCatalog: true,
        sourceAvailability: SourceCommercialAvailability.unknown,
      }).eligible,
    ).toBe(true);
  });

  it('native / unclassified stay compatible', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.native_marketplace,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.unknown,
      }).eligible,
    ).toBe(true);
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.unclassified,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.unknown,
      }).eligible,
    ).toBe(true);
  });
});

describe('Search V1 ranking config', () => {
  it('keeps exact name above brand/category/typo weights', () => {
    expect(SEARCH_RANKING_WEIGHTS.exactNormalizedName).toBeGreaterThan(
      SEARCH_RANKING_WEIGHTS.exactBrandAlias,
    );
    expect(SEARCH_RANKING_WEIGHTS.exactBrandAlias).toBeGreaterThan(
      SEARCH_RANKING_WEIGHTS.typoBrandAlias,
    );
    expect(SEARCH_RANKING_WEIGHTS.namePrefix).toBeGreaterThan(
      SEARCH_RANKING_WEIGHTS.canonicalCategory,
    );
  });
});

describe('Search UX V1.1 suggestions', () => {
  it('ranks brand alias exact above category and product prefixes', () => {
    expect(SUGGESTION_RANKING_WEIGHTS.exactBrandAlias).toBeGreaterThan(
      SUGGESTION_RANKING_WEIGHTS.brandAliasPrefix,
    );
    expect(SUGGESTION_RANKING_WEIGHTS.brandAliasPrefix).toBeGreaterThan(
      SUGGESTION_RANKING_WEIGHTS.categoryPrefix,
    );
    expect(SUGGESTION_RANKING_WEIGHTS.categoryPrefix).toBeGreaterThan(
      SUGGESTION_RANKING_WEIGHTS.productTitlePrefix,
    );
  });

  it('omits product suggestions for 1-character queries and bounds max results', () => {
    expect(SUGGESTION_MIN_PRODUCT_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
    expect(SUGGESTION_MAX_RESULTS).toBeLessThanOrEqual(8);
  });

  it('validates suggestion query and rejects empty / oversized input', () => {
    expect(parseStorefrontSuggestionQuery({ q: '' }).ok).toBe(false);
    expect(parseStorefrontSuggestionQuery({ q: 'n' }).ok).toBe(true);
    expect(parseStorefrontSuggestionQuery({ q: 'a'.repeat(80) }).ok).toBe(
      false,
    );
    expect(parseStorefrontSuggestionQuery({ q: 'ni', limit: '99' }).ok).toBe(
      false,
    );
  });

  it('keeps Nike/Adidas aliases data-driven for suggestion matching', () => {
    const nike = BRAND_ALIAS_DEFAULTS.find((g) => g.key === 'nike');
    expect(nike?.aliases).toEqual(
      expect.arrayContaining(['nike', 'نایک', 'نایکی']),
    );
    expect(JSON.stringify(SUGGESTION_RANKING_WEIGHTS)).not.toMatch(
      /nike|نایک/i,
    );
  });
});
