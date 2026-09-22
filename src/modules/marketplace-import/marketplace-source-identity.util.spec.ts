import {
  buildActiveDedupKey,
  identityFromCanonical,
} from './marketplace-source-identity.util';

describe('MarketplaceSourceIdentity', () => {
  const identity = {
    marketplace: 'trendyol' as const,
    sourceProductId: '1234567',
    canonicalUrl: 'https://www.trendyol.com/brand/x-p-1234567',
    sourceUrl: '/brand/x-p-1234567',
  };

  it('builds stable active dedup key', () => {
    const sourceIdentity = identityFromCanonical(identity);
    expect(buildActiveDedupKey(sourceIdentity)).toBe('trendyol:1234567');
  });

  it('converges canonical identity fields', () => {
    const sourceIdentity = identityFromCanonical(identity);
    expect(sourceIdentity.source).toBe('trendyol');
    expect(sourceIdentity.sourceProductId).toBe('1234567');
  });
});
