export type DiscountListingCandidate = {
  sourceId: string;
  url: string;
  name?: string | null;
  listPrice: number | null;
  salePrice: number | null;
  listingDiscountPct?: number | null;
  categoryName?: string | null;
  sourceCategoryId?: number | string | null;
  hasBasketOnlyPromo?: boolean;
  flashTags?: string[];
  sourceLabel?: string;
};

export type DiscountListingFilterResult = {
  accepted: DiscountListingCandidate[];
  rejected: Array<DiscountListingCandidate & { reason: string }>;
};

const BASKET_PROMO_RE =
  /sepet|sepette|basket|ty\s*plus|kodu|code\s*promo|coupon/i;

export function isGenuineListingPriceGap(
  listPrice: number | null | undefined,
  salePrice: number | null | undefined,
): boolean {
  const list = Number(listPrice);
  const sale = Number(salePrice);
  return (
    Number.isFinite(list) &&
    Number.isFinite(sale) &&
    list > 0 &&
    sale > 0 &&
    sale < list
  );
}

export function listingDiscountPercent(
  listPrice: number,
  salePrice: number,
): number {
  return Math.round(((listPrice - salePrice) / listPrice) * 1000) / 10;
}

export function hasValidTrendyolIdentity(c: {
  sourceId?: string | null;
  url?: string | null;
}): boolean {
  const id = String(c.sourceId || '').trim();
  const url = String(c.url || '').trim();
  if (!/^\d+$/.test(id)) return false;
  if (!url || !new RegExp(`-p-${id}(?:\\?|$)`, 'i').test(url.split('?')[0])) {
    // Allow id-centric paths too
    if (!/\/p\/product-p-\d+/i.test(url) && !/-p-\d+/i.test(url)) return false;
  }
  return true;
}

export function isBasketOnlyPromoSignal(c: DiscountListingCandidate): boolean {
  if (c.hasBasketOnlyPromo === true) return true;
  if (isGenuineListingPriceGap(c.listPrice, c.salePrice)) return false;
  // Badge/text-only without price gap
  return true;
}

/**
 * Pure shortlist filter. Assortment allowlist is the set of accepted Trendyol
 * category names (sourceName) already known IN_SCOPE in Local.
 */
export function filterDiscountListingCandidates(
  candidates: DiscountListingCandidate[],
  opts: {
    allowedCategoryNames: ReadonlySet<string>;
    minDiscountPct?: number;
    preferMinPct?: number;
  },
): DiscountListingFilterResult {
  const minPct = opts.minDiscountPct ?? 0;
  const preferPct = opts.preferMinPct ?? 30;
  const rejected: Array<DiscountListingCandidate & { reason: string }> = [];
  const byId = new Map<string, DiscountListingCandidate>();

  for (const raw of candidates) {
    const c = { ...raw, sourceId: String(raw.sourceId || '').trim() };
    if (!hasValidTrendyolIdentity(c)) {
      rejected.push({ ...c, reason: 'invalid_identity_or_url' });
      continue;
    }
    if (!isGenuineListingPriceGap(c.listPrice, c.salePrice)) {
      rejected.push({ ...c, reason: 'not_genuine_list_sale_gap' });
      continue;
    }
    const pct = listingDiscountPercent(
      Number(c.listPrice),
      Number(c.salePrice),
    );
    c.listingDiscountPct = pct;
    if (pct < minPct) {
      rejected.push({ ...c, reason: 'below_min_discount' });
      continue;
    }
    const cat = String(c.categoryName || '').trim();
    if (!cat || !opts.allowedCategoryNames.has(cat)) {
      rejected.push({ ...c, reason: 'unsupported_or_ambiguous_category' });
      continue;
    }
    if (
      c.hasBasketOnlyPromo === true ||
      (typeof (c as any).promoText === 'string' &&
        BASKET_PROMO_RE.test((c as any).promoText) &&
        !isGenuineListingPriceGap(c.listPrice, c.salePrice))
    ) {
      rejected.push({ ...c, reason: 'basket_only_promo' });
      continue;
    }

    const prev = byId.get(c.sourceId);
    if (!prev || (c.listingDiscountPct ?? 0) > (prev.listingDiscountPct ?? 0)) {
      byId.set(c.sourceId, c);
    }
  }

  const accepted = [...byId.values()].sort((a, b) => {
    const ap = a.listingDiscountPct ?? 0;
    const bp = b.listingDiscountPct ?? 0;
    const aPref = ap >= preferPct ? 1 : 0;
    const bPref = bp >= preferPct ? 1 : 0;
    if (bPref !== aPref) return bPref - aPref;
    return bp - ap;
  });

  return { accepted, rejected };
}
