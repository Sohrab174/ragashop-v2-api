import { CanonicalMarketplaceIdentity } from './marketplace-url.validator';

export interface MarketplaceSourceIdentity {
  source: string;
  sourceProductId: string;
  canonicalUrl: string;
  sourceUrl: string;
}

export function identityFromCanonical(
  identity: CanonicalMarketplaceIdentity,
): MarketplaceSourceIdentity {
  return {
    source: identity.marketplace,
    sourceProductId: identity.sourceProductId,
    canonicalUrl: identity.canonicalUrl,
    sourceUrl: identity.sourceUrl,
  };
}

export function buildActiveDedupKey(
  identity: MarketplaceSourceIdentity,
): string {
  return `${identity.source}:${identity.sourceProductId}`;
}

export function toCanonicalMarketplaceIdentity(
  identity: MarketplaceSourceIdentity,
): CanonicalMarketplaceIdentity {
  if (identity.source !== 'trendyol') {
    throw new Error(`Unsupported marketplace source: ${identity.source}`);
  }

  return {
    marketplace: 'trendyol',
    sourceProductId: identity.sourceProductId,
    canonicalUrl: identity.canonicalUrl,
    sourceUrl: identity.sourceUrl,
  };
}
