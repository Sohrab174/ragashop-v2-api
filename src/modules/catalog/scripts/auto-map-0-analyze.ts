/**
 * READ-ONLY AUTO-MAP-0 dry-run: category auto-mapping forensic analysis.
 *
 * Usage (from ragashop-api):
 *   npm run catalog:auto-map:analyze
 *
 * SELECT queries only. Never writes to the database. Deterministic; no AI or
 * external calls. Writes JSON reports under %TEMP%/auto-map-0.
 */
import { createConnection } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { discoveryEligibilitySql } from '../../product/discovery-eligibility';
import {
  accumulateProduct,
  AUTO_MAP_ENGINE_VERSION,
  AUTO_MAP_THRESHOLDS,
  AutoMapTier,
  CanonicalInput,
  canonicalAudienceOf,
  CONCEPT_FALLBACK,
  emptyNodeDistribution,
  matchDomainConcept,
  REASON_FA,
  SourceNodeInput,
  TIER_ORDER,
} from '../auto-map-0.matcher';
import { buildAutoMapContext } from '../auto-map-0.pipeline';
import {
  buildAssortmentAwareCoverage,
  classifyLegacyMappingsByAssortment,
  resolveAssortmentGate,
} from '../assortment-policy/assortment-auto-map.gate';

type MappingRow = {
  id: number;
  source: string;
  sourceCategoryId: number;
  canonicalCategoryId: number;
  genderSlice: string;
  status: string;
  reviewStatus: string;
};

type ProductRow = {
  id: number;
  categoryId: number;
  gender: string | null;
  ageGroup: string | null;
  sourceName: string | null;
};

const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 10000) / 100 : 0;

function histogram(values: number[], edges: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const key = hi == null ? `>=${lo}` : `[${lo},${hi})`;
    out[key] = values.filter((v) => v >= lo && (hi == null || v < hi)).length;
  }
  return out;
}

async function main() {
  const conn = await createConnection();
  try {
    const canonicals: CanonicalInput[] = await conn.query(
      `SELECT id, parentId, name, status, audience FROM canonical_category ORDER BY id`,
    );
    const categories: SourceNodeInput[] = await conn.query(
      `SELECT id, parentId, source, sourceName, name, hierarchy, bankTypeName,
              gender, status
       FROM category ORDER BY id`,
    );
    const mappings: MappingRow[] = await conn.query(
      `SELECT id, source, sourceCategoryId, canonicalCategoryId, genderSlice,
              status, reviewStatus
       FROM source_category_mapping ORDER BY id`,
    );
    const products: ProductRow[] = await conn.query(
      `SELECT p.id, p.categoryId, p.gender, p.ageGroup, p.sourceName
       FROM product p
       WHERE p.isDeleted = 0 AND p.status = 'active' AND p.price > 0
         AND p.categoryId != 1 AND ${discoveryEligibilitySql('p')}`,
    );
    // SCOPE-3/4: assortment resolutions gate AUTO-MAP eligibility (IN only).
    let assortmentRows: Array<{ categoryId: number; status: string }> = [];
    try {
      assortmentRows = await conn.query(
        `SELECT categoryId, status FROM category_assortment_resolution`,
      );
    } catch {
      assortmentRows = [];
    }
    const assortmentStatusById = new Map(
      assortmentRows.map((r) => [Number(r.categoryId), String(r.status)]),
    );

    const {
      catById,
      unknownLabels,
      sourcePath,
      canonPath,
      ownDist,
      titlesByCat,
      productsByCat,
      scopeOf,
      evaluate,
      productNodes,
      totalDiscoverable,
    } = buildAutoMapContext({ canonicals, categories, products });

    // ── legacy scope + current CAT-3B visibility ───────────────────────────
    const legacyScopeByMapping = new Map<number, number[]>();
    const legacyCovered = new Map<number, number[]>(); // cat → mapping ids
    for (const m of mappings) {
      if (m.status !== 'active') continue;
      const ids = scopeOf(Number(m.sourceCategoryId), m.source);
      legacyScopeByMapping.set(m.id, ids);
      for (const sid of ids) {
        const list = legacyCovered.get(sid) || [];
        list.push(m.id);
        legacyCovered.set(sid, list);
      }
    }
    const rootAudienceOfCanon = (id: number) =>
      canonicalAudienceOf(canonPath(id)[0]?.audience);
    const visibleUnder = (aud: string, gender: string | null) =>
      aud === 'women'
        ? gender === 'female' || gender === 'unisex'
        : aud === 'men'
        ? gender === 'male' || gender === 'unisex'
        : true;

    const legacyVisibleProductIds = new Set<number>();
    for (const m of mappings) {
      const ids = legacyScopeByMapping.get(m.id) || [];
      const aud = rootAudienceOfCanon(Number(m.canonicalCategoryId));
      for (const sid of ids) {
        for (const p of productsByCat.get(sid) || []) {
          if (visibleUnder(aud, p.gender)) legacyVisibleProductIds.add(p.id);
        }
      }
    }

    // ── dry run over product-bearing nodes ─────────────────────────────────
    const nodeResults = productNodes.map((id) => {
      const r = evaluate(id);
      const node = catById.get(id)!;
      const own = ownDist.get(id)!;
      const assortmentStatus = assortmentStatusById.get(id) || null;
      const gate = resolveAssortmentGate(assortmentStatus);
      return {
        ...r,
        sourceName: node.sourceName,
        localPath: sourcePath(id)
          .map((c) => c.sourceName || c.name)
          .join(' > '),
        hierarchy: node.hierarchy,
        bankTypeName: node.bankTypeName,
        own,
        legacyMappingIds: legacyCovered.get(id) || [],
        reasonsFa: r.reasonCodes.map((c) => REASON_FA[c] || c),
        assortmentStatus,
        assortmentGate: gate.action,
        mappingEligible: gate.mappingEligible,
      };
    });
    // Mapping proposals only for IN_SCOPE. REVIEW/OUT are not mapping failures.
    const mappingEligibleNodes = nodeResults.filter((r) => r.mappingEligible);
    const assortmentQueueNodes = nodeResults.filter(
      (r) => r.assortmentGate === 'ASSORTMENT_QUEUE',
    );
    const outStoppedNodes = nodeResults.filter(
      (r) => r.assortmentGate === 'STOP_OUT_OF_SCOPE',
    );

    // Own-products routing per proposal (no scope double counting).
    const routedOwn = (r: typeof nodeResults[number]) => {
      let routed = 0;
      const slices = new Set(r.rules.map((x) => x.genderSlice));
      for (const p of productsByCat.get(r.sourceCategoryId) || []) {
        if (slices.has('any')) routed++;
        else if (
          (slices.has('female') &&
            (p.gender === 'female' || p.gender === 'unisex')) ||
          (slices.has('male') && (p.gender === 'male' || p.gender === 'unisex'))
        )
          routed++;
      }
      return routed;
    };

    const unmapped = nodeResults.filter((r) => !r.legacyMappingIds.length);
    const mappedNodes = nodeResults.filter((r) => r.legacyMappingIds.length);

    const tierSummary = (rows: typeof nodeResults) => {
      const out: Record<
        string,
        { categories: number; products: number; routable: number }
      > = {};
      for (const t of TIER_ORDER)
        out[t] = { categories: 0, products: 0, routable: 0 };
      for (const r of rows) {
        out[r.tier].categories++;
        out[r.tier].products += r.own.total;
        out[r.tier].routable += routedOwn(r);
      }
      return out;
    };

    // ── coverage metrics ───────────────────────────────────────────────────
    const productIdsRoutedBy = (
      rows: typeof nodeResults,
      tiers: AutoMapTier[],
    ) => {
      const ids = new Set<number>();
      for (const r of rows) {
        if (!tiers.includes(r.tier)) continue;
        const slices = new Set(r.rules.map((x) => x.genderSlice));
        for (const p of productsByCat.get(r.sourceCategoryId) || []) {
          if (
            slices.has('any') ||
            (slices.has('female') &&
              (p.gender === 'female' || p.gender === 'unisex')) ||
            (slices.has('male') &&
              (p.gender === 'male' || p.gender === 'unisex'))
          )
            ids.add(p.id);
        }
      }
      return ids;
    };
    const unmappedHigh = productIdsRoutedBy(unmapped, [
      'AUTO_MAP_HIGH_CONFIDENCE',
    ]);
    const unmappedHighSuggest = productIdsRoutedBy(unmapped, [
      'AUTO_MAP_HIGH_CONFIDENCE',
      'AUTO_SUGGEST_REVIEW',
    ]);
    const unmappedHighApplyNow = new Set<number>();
    for (const r of unmapped) {
      if (r.tier !== 'AUTO_MAP_HIGH_CONFIDENCE' || !r.autoApplyEligible)
        continue;
      for (const id of productIdsRoutedBy([r], ['AUTO_MAP_HIGH_CONFIDENCE']))
        unmappedHighApplyNow.add(id);
    }
    const allHigh = productIdsRoutedBy(nodeResults, [
      'AUTO_MAP_HIGH_CONFIDENCE',
    ]);
    const allHighSuggest = productIdsRoutedBy(nodeResults, [
      'AUTO_MAP_HIGH_CONFIDENCE',
      'AUTO_SUGGEST_REVIEW',
    ]);
    const union = (a: Set<number>, b: Set<number>) => new Set([...a, ...b]);
    const legacyPlusHigh = union(legacyVisibleProductIds, unmappedHigh);
    const legacyPlusHighSuggest = union(
      legacyVisibleProductIds,
      unmappedHighSuggest,
    );

    // Unroutable buckets (all nodes, own products).
    let kidsInAdult = 0;
    let nullAdult = 0;
    let noDestProducts = 0;
    let blockedProducts = 0;
    let humanProducts = 0;
    let sliceNoDest = 0;
    for (const r of nodeResults) {
      if (r.tier === 'NO_DESTINATION') noDestProducts += r.own.total;
      if (r.tier === 'DATA_QUALITY_BLOCKED') blockedProducts += r.own.total;
      if (r.tier === 'HUMAN_REVIEW_REQUIRED') humanProducts += r.own.total;
      if (
        r.tier === 'AUTO_MAP_HIGH_CONFIDENCE' ||
        r.tier === 'AUTO_SUGGEST_REVIEW'
      ) {
        if (r.audienceMode !== 'kids' && r.audienceMode !== 'neutral') {
          kidsInAdult += r.own.child;
          nullAdult += r.own.adultNullGender;
          const slices = new Set(r.rules.map((x) => x.genderSlice));
          if (!slices.has('female')) sliceNoDest += r.own.female;
          if (!slices.has('male')) sliceNoDest += r.own.male;
        }
      }
    }
    const kidsAllAdultNodes = nodeResults
      .filter((r) => r.audienceMode !== 'kids')
      .reduce((s, r) => s + r.own.child, 0);

    // ── domain breakdown ───────────────────────────────────────────────────
    const segmentOf = (r: typeof nodeResults[number]) =>
      r.audienceMode === 'kids'
        ? 'kids'
        : r.audienceMode === 'neutral'
        ? 'neutral'
        : r.audienceMode === 'women_only'
        ? 'women'
        : r.audienceMode === 'men_only'
        ? 'men'
        : r.audienceMode === 'mixed' || r.audienceMode === 'unisex_only'
        ? 'mixed_adult'
        : 'unknown';
    const segments: Record<
      string,
      Record<string, { categories: number; products: number }>
    > = {};
    for (const r of nodeResults) {
      const s = segmentOf(r);
      segments[s] = segments[s] || {};
      const t = (segments[s][r.tier] = segments[s][r.tier] || {
        categories: 0,
        products: 0,
      });
      t.categories++;
      t.products += r.own.total;
    }

    // ── distributions (threshold evidence) ─────────────────────────────────
    const gendered = nodeResults.filter(
      (r) =>
        ['clothing', 'shoe', 'accessory'].includes(r.domain) &&
        r.audienceMode !== 'kids' &&
        r.audienceMode !== 'neutral',
    );
    const minorityShares: Array<{
      id: number;
      name: string | null;
      adult: number;
      minority: number;
    }> = [];
    for (const r of gendered) {
      const adult = r.own.total - r.own.child;
      if (adult < 20) continue;
      const minority = Math.min(r.own.female, r.own.male) / adult;
      minorityShares.push({
        id: r.sourceCategoryId,
        name: r.sourceName,
        adult,
        minority: Math.round(minority * 10000) / 10000,
      });
    }
    minorityShares.sort((a, b) => a.minority - b.minority);
    const kidsShares = nodeResults
      .filter((r) => r.own.child > 0)
      .map((r) => ({
        id: r.sourceCategoryId,
        name: r.sourceName,
        total: r.own.total,
        kidsShare: Math.round((r.own.child / r.own.total) * 10000) / 10000,
        structural: r.audienceMode === 'kids',
      }))
      .sort((a, b) => a.kidsShare - b.kidsShare);
    const adultNullShares = gendered
      .map((r) => {
        const adult = r.own.total - r.own.child;
        return {
          id: r.sourceCategoryId,
          name: r.sourceName,
          adult,
          adultNullShare: adult
            ? Math.round((r.own.adultNullGender / adult) * 10000) / 10000
            : 0,
        };
      })
      .filter((x) => x.adultNullShare > 0)
      .sort((a, b) => b.adultNullShare - a.adultNullShare);
    const titleAgreement = gendered
      .map((r) => {
        const titled = r.own.titleFemale + r.own.titleMale;
        return {
          id: r.sourceCategoryId,
          name: r.sourceName,
          titled,
          agreement: titled
            ? Math.round(
                ((r.own.titleFemaleAgree + r.own.titleMaleAgree) / titled) *
                  10000,
              ) / 10000
            : null,
        };
      })
      .filter((x) => x.titled >= AUTO_MAP_THRESHOLDS.titleMinSample)
      .sort((a, b) => (a.agreement ?? 1) - (b.agreement ?? 1));
    const sensitivity: Record<string, number> = {};
    for (const noise of [0.005, 0.01, 0.02, 0.03, 0.05, 0.1]) {
      sensitivity[String(noise)] = minorityShares.filter(
        (m) => m.minority <= noise,
      ).length;
    }
    const globalTitle = products.reduce(
      (acc, p) => {
        const d = emptyNodeDistribution();
        accumulateProduct(d, p);
        acc.f += d.titleFemale;
        acc.fa += d.titleFemaleAgree;
        acc.m += d.titleMale;
        acc.ma += d.titleMaleAgree;
        return acc;
      },
      { f: 0, fa: 0, m: 0, ma: 0 },
    );

    // ── false-positive review (title concept agreement on HIGH) ────────────
    const fpReview = nodeResults
      .filter((r) => r.tier === 'AUTO_MAP_HIGH_CONFIDENCE')
      .map((r) => {
        const titles = titlesByCat.get(r.sourceCategoryId) || [];
        let hit = 0;
        let conflict = 0;
        let none = 0;
        const conflictSamples: string[] = [];
        for (const t of titles) {
          const res = matchDomainConcept(t, r.domain);
          if (!res) none++;
          else {
            const dest = CONCEPT_FALLBACK[res] || res;
            if (res === r.concept || dest === r.destinationConcept) hit++;
            else {
              conflict++;
              if (conflictSamples.length < 3)
                conflictSamples.push(`${t} → ${res}`);
            }
          }
        }
        return {
          id: r.sourceCategoryId,
          name: r.sourceName,
          domain: r.domain,
          concept: r.concept,
          rules: r.rules.map(
            (x) =>
              `${x.genderSlice}→${x.canonicalCategoryId} ${x.canonicalPath}`,
          ),
          products: titles.length,
          titleHit: hit,
          titleConflict: conflict,
          titleNoSignal: none,
          conflictRate: titles.length
            ? Math.round((conflict / titles.length) * 10000) / 10000
            : 0,
          conflictSamples,
          sampleTitles: titles.slice(0, 3),
          impact: r.impactProducts,
          reasonCodes: r.reasonCodes,
        };
      })
      .sort((a, b) => b.products - a.products);

    // ── legacy recommendations ─────────────────────────────────────────────
    const legacy = mappings.map((m) => {
      const r = evaluate(Number(m.sourceCategoryId));
      const scopeIds = legacyScopeByMapping.get(m.id) || [];
      const legacyAud = rootAudienceOfCanon(Number(m.canonicalCategoryId));
      let scopeProducts = 0;
      let legacyVisible = 0;
      const scopeGender = { f: 0, m: 0, u: 0, n: 0, child: 0 };
      for (const sid of scopeIds) {
        for (const p of productsByCat.get(sid) || []) {
          scopeProducts++;
          if (visibleUnder(legacyAud, p.gender)) legacyVisible++;
          if (p.gender === 'female') scopeGender.f++;
          else if (p.gender === 'male') scopeGender.m++;
          else if (p.gender === 'unisex') scopeGender.u++;
          else scopeGender.n++;
          if (p.ageGroup === 'child') scopeGender.child++;
        }
      }
      const engineRouted = r.rules.reduce((s, x) => s + x.routedProducts, 0);
      const engineDestIds = r.rules.map((x) => x.canonicalCategoryId);
      const disagreements: string[] = [];
      const engineAud =
        r.audienceMode === 'kids'
          ? 'kids'
          : r.audienceMode === 'neutral'
          ? 'neutral'
          : r.audienceMode === 'women_only'
          ? 'women'
          : r.audienceMode === 'men_only'
          ? 'men'
          : r.audienceMode === 'unknown'
          ? 'unknown'
          : 'mixed';
      if (
        engineAud === 'mixed' &&
        (legacyAud === 'women' || legacyAud === 'men')
      ) {
        disagreements.push('MIXED_SOURCE_TO_SINGLE_GENDER_ROOT');
      } else if (
        engineAud !== 'unknown' &&
        engineAud !== legacyAud &&
        !(engineAud === 'neutral' && legacyAud === 'neutral')
      ) {
        disagreements.push(
          `AUDIENCE_${String(
            engineAud,
          ).toUpperCase()}_VS_LEGACY_${legacyAud.toUpperCase()}`,
        );
      }
      if (
        r.rules.length &&
        !engineDestIds.includes(Number(m.canonicalCategoryId))
      ) {
        disagreements.push('DESTINATION_DIFFERS');
      }
      if (scopeProducts === 0) disagreements.push('LEGACY_SCOPE_EMPTY');
      if (
        r.tier === 'DATA_QUALITY_BLOCKED' &&
        r.reasonCodes.includes('SCOPE_CONTAMINATION')
      ) {
        disagreements.push('LEGACY_SCOPE_CONTAMINATED');
      }
      const hidden = scopeProducts - legacyVisible;
      if (hidden > 0 && (legacyAud === 'women' || legacyAud === 'men')) {
        disagreements.push('LEGACY_HIDES_PRODUCTS');
      }

      let recommendation: string;
      const sameSingle =
        r.rules.length === 1 &&
        Number(r.rules[0].canonicalCategoryId) ===
          Number(m.canonicalCategoryId);
      if (scopeProducts === 0) recommendation = 'HUMAN_REVIEW_REQUIRED';
      else if (r.tier === 'NO_DESTINATION') recommendation = 'NO_DESTINATION';
      else if (r.tier === 'DATA_QUALITY_BLOCKED')
        recommendation = 'DATA_QUALITY_BLOCKED';
      else if (r.tier === 'HUMAN_REVIEW_REQUIRED')
        recommendation = 'HUMAN_REVIEW_REQUIRED';
      else if (r.tier === 'AUTO_SUGGEST_REVIEW')
        recommendation = 'AUTO_SUGGEST_REVIEW';
      else if (sameSingle && r.rules[0].genderSlice === 'any')
        recommendation = 'KEEP_AS_LEGACY';
      else if (engineDestIds.includes(Number(m.canonicalCategoryId)))
        recommendation = 'AUTO_CONVERT_HIGH_CONFIDENCE';
      else recommendation = 'HUMAN_REVIEW_REQUIRED';

      const src = catById.get(Number(m.sourceCategoryId));
      return {
        mappingId: m.id,
        sourceCategoryId: Number(m.sourceCategoryId),
        sourceName: src?.sourceName ?? null,
        localPath: sourcePath(Number(m.sourceCategoryId))
          .map((c) => c.sourceName || c.name)
          .join(' > '),
        legacy: {
          canonicalCategoryId: Number(m.canonicalCategoryId),
          canonicalPath: canonPath(Number(m.canonicalCategoryId))
            .map((c) => c.name)
            .join(' / '),
          rootAudience: legacyAud,
          genderSlice: m.genderSlice,
          reviewStatus: m.reviewStatus,
          scopeCategories: scopeIds.length,
          scopeProducts,
          visibleUnderCat3b: legacyVisible,
          hiddenUnderCat3b: hidden,
          scopeGender,
        },
        engine: {
          tier: r.tier,
          concept: r.concept,
          audienceMode: r.audienceMode,
          rules: r.rules,
          routedProducts: engineRouted,
          reasonCodes: r.reasonCodes,
          writeBlockers: r.writeBlockers,
          contaminatedDescendantIds: r.contaminatedDescendantIds,
        },
        recommendation,
        disagreements,
      };
    });
    const legacyRecSummary = legacy.reduce((acc, l) => {
      acc[l.recommendation] = (acc[l.recommendation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // ── examples per class ─────────────────────────────────────────────────
    const ex = (pred: (r: typeof nodeResults[number]) => boolean, n = 6) =>
      nodeResults
        .filter(pred)
        .sort((a, b) => b.own.total - a.own.total)
        .slice(0, n)
        .map((r) => ({
          id: r.sourceCategoryId,
          name: r.sourceName,
          hierarchy: r.hierarchy,
          products: r.own.total,
          gender: `${r.own.female}f/${r.own.male}m/${r.own.unisex}u/${r.own.nullGender}n child=${r.own.child}`,
          tier: r.tier,
          concept: r.concept,
          rules: r.rules.map(
            (x) =>
              `${x.genderSlice}→${x.canonicalCategoryId} ${x.canonicalPath}`,
          ),
          reasonCodes: r.reasonCodes,
          legacy: r.legacyMappingIds,
        }));
    const examples = {
      highNeutral: ex(
        (r) =>
          r.tier === 'AUTO_MAP_HIGH_CONFIDENCE' && r.audienceMode === 'neutral',
      ),
      highWomenMen: ex(
        (r) =>
          r.tier === 'AUTO_MAP_HIGH_CONFIDENCE' &&
          (r.audienceMode === 'women_only' || r.audienceMode === 'men_only'),
      ),
      mixedAdult: ex((r) => r.audienceMode === 'mixed'),
      kids: ex((r) => r.audienceMode === 'kids' || r.own.child > 0),
      medium: ex((r) => r.tier === 'AUTO_SUGGEST_REVIEW'),
      human: ex((r) => r.tier === 'HUMAN_REVIEW_REQUIRED'),
      blocked: ex((r) => r.tier === 'DATA_QUALITY_BLOCKED'),
      noDestination: ex((r) => r.tier === 'NO_DESTINATION', 10),
    };

    // ── missing destination concepts (gap list) ────────────────────────────
    const gapByConcept: Record<
      string,
      { categories: number; products: number; audiences: Set<string> }
    > = {};
    for (const r of nodeResults) {
      const missing =
        r.tier === 'NO_DESTINATION' ||
        r.reasonCodes.some((c) => c.startsWith('NO_DESTINATION_'));
      if (!missing) continue;
      const key = r.concept || '(none)';
      const g = (gapByConcept[key] = gapByConcept[key] || {
        categories: 0,
        products: 0,
        audiences: new Set<string>(),
      });
      g.categories++;
      if (r.tier === 'NO_DESTINATION') g.products += r.own.total;
      else g.products += r.unroutable.sliceWithoutDestination;
      for (const c of r.reasonCodes)
        if (c.startsWith('NO_DESTINATION_'))
          g.audiences.add(c.replace('NO_DESTINATION_', ''));
    }
    const gaps = Object.entries(gapByConcept)
      .map(([concept, g]) => ({
        concept,
        categories: g.categories,
        products: g.products,
        missingFor: [...g.audiences],
      }))
      .sort((a, b) => b.products - a.products);

    const legacyVisibleCount = legacyVisibleProductIds.size;

    // SCOPE-3/4 assortment-aware coverage (IN_SCOPE denominator only).
    const inScopeHigh = productIdsRoutedBy(mappingEligibleNodes, [
      'AUTO_MAP_HIGH_CONFIDENCE',
    ]);
    const inScopeHighSuggest = productIdsRoutedBy(mappingEligibleNodes, [
      'AUTO_MAP_HIGH_CONFIDENCE',
      'AUTO_SUGGEST_REVIEW',
    ]);
    const inScopeMissingDestNodes = mappingEligibleNodes.filter(
      (r) => r.tier === 'NO_DESTINATION',
    );
    const assortmentByStatus: Record<
      string,
      { categories: number; discoverableProducts: number }
    > = {
      IN_SCOPE: { categories: 0, discoverableProducts: 0 },
      REVIEW_REQUIRED: { categories: 0, discoverableProducts: 0 },
      OUT_OF_SCOPE: { categories: 0, discoverableProducts: 0 },
    };
    for (const [cid, st] of assortmentStatusById) {
      if (!assortmentByStatus[st]) continue;
      assortmentByStatus[st].categories++;
      assortmentByStatus[st].discoverableProducts +=
        ownDist.get(cid)?.total || 0;
    }
    const assortmentAware = buildAssortmentAwareCoverage({
      totalDiscoverable,
      byStatus: assortmentByStatus,
      inScopeMissingDestination: {
        categories: inScopeMissingDestNodes.length,
        discoverableProducts: inScopeMissingDestNodes.reduce(
          (s, r) => s + r.own.total,
          0,
        ),
      },
      autoMapHighRoutable: inScopeHigh.size,
      autoMapHighSuggestRoutable: inScopeHighSuggest.size,
    });
    const legacyByAssortment = classifyLegacyMappingsByAssortment({
      mappings: mappings.map((m) => ({
        id: Number(m.id),
        sourceCategoryId: Number(m.sourceCategoryId),
      })),
      statusByCategoryId: assortmentStatusById,
    });

    const summary = {
      engineVersion: AUTO_MAP_ENGINE_VERSION,
      thresholds: AUTO_MAP_THRESHOLDS,
      totals: {
        discoverableProducts: totalDiscoverable,
        sourceCategories: categories.length,
        productBearingCategories: productNodes.length,
        unmappedProductBearingCategories: unmapped.length,
        unmappedProducts: unmapped.reduce((s, r) => s + r.own.total, 0),
        legacyMappings: mappings.length,
        legacyCoveredCategories: legacyCovered.size,
        mappingEligibleNodes: mappingEligibleNodes.length,
        assortmentQueueNodes: assortmentQueueNodes.length,
        outStoppedNodes: outStoppedNodes.length,
      },
      unmappedByTier: tierSummary(unmapped),
      allNodesByTier: tierSummary(nodeResults),
      mappedNodesByTier: tierSummary(mappedNodes),
      inScopeNodesByTier: tierSummary(mappingEligibleNodes),
      assortmentAware,
      legacyMappingsByAssortment: {
        byStatus: {
          IN_SCOPE: legacyByAssortment.byStatus.IN_SCOPE.count,
          REVIEW_REQUIRED: legacyByAssortment.byStatus.REVIEW_REQUIRED.count,
          OUT_OF_SCOPE: legacyByAssortment.byStatus.OUT_OF_SCOPE.count,
        },
        unresolvableCount: legacyByAssortment.unresolvable.length,
      },
      coverage: {
        legacyVisibleNow: {
          products: legacyVisibleCount,
          pct: pct(legacyVisibleCount, totalDiscoverable),
        },
        unmappedHigh: {
          products: unmappedHigh.size,
          pct: pct(unmappedHigh.size, totalDiscoverable),
        },
        unmappedHighAutoApplyNow: {
          products: unmappedHighApplyNow.size,
          pct: pct(unmappedHighApplyNow.size, totalDiscoverable),
        },
        unmappedHighPlusSuggest: {
          products: unmappedHighSuggest.size,
          pct: pct(unmappedHighSuggest.size, totalDiscoverable),
        },
        legacyPlusUnmappedHigh: {
          products: legacyPlusHigh.size,
          pct: pct(legacyPlusHigh.size, totalDiscoverable),
        },
        legacyPlusUnmappedHighSuggest: {
          products: legacyPlusHighSuggest.size,
          pct: pct(legacyPlusHighSuggest.size, totalDiscoverable),
        },
        engineOnlyAllNodesHigh: {
          products: allHigh.size,
          pct: pct(allHigh.size, totalDiscoverable),
        },
        engineOnlyAllNodesHighSuggest: {
          products: allHighSuggest.size,
          pct: pct(allHighSuggest.size, totalDiscoverable),
        },
        unroutable: {
          noDestinationProducts: noDestProducts,
          dataQualityBlockedProducts: blockedProducts,
          humanReviewProducts: humanProducts,
          kidsInsideAdultCategoriesAll: kidsAllAdultNodes,
          kidsInsideAdultProposals: kidsInAdult,
          nullGenderAdultInProposals: nullAdult,
          sliceWithoutDestinationInProposals: sliceNoDest,
        },
      },
      segments,
      legacyRecommendations: legacyRecSummary,
      unknownCanonicalLabels: unknownLabels,
      distributions: {
        minorityShareHistogram: histogram(
          minorityShares.map((m) => m.minority),
          [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.3, 0.4],
        ),
        oppositeNoiseSensitivity: sensitivity,
        kidsShareHistogram: histogram(
          kidsShares.filter((k) => !k.structural).map((k) => k.kidsShare),
          [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.9],
        ),
        globalTitleAgreement: {
          titleFemale: globalTitle.f,
          titleFemaleAgree: globalTitle.fa,
          femaleAgreementPct: pct(globalTitle.fa, globalTitle.f),
          titleMale: globalTitle.m,
          titleMaleAgree: globalTitle.ma,
          maleAgreementPct: pct(globalTitle.ma, globalTitle.m),
        },
      },
      falsePositiveReview: {
        highCategories: fpReview.length,
        highProducts: fpReview.reduce((s, r) => s + r.products, 0),
        titleConflictProducts: fpReview.reduce(
          (s, r) => s + r.titleConflict,
          0,
        ),
        titleHitProducts: fpReview.reduce((s, r) => s + r.titleHit, 0),
        titleNoSignalProducts: fpReview.reduce(
          (s, r) => s + r.titleNoSignal,
          0,
        ),
      },
    };

    const out = {
      summary,
      gaps,
      examples,
      legacy,
      distributions: {
        minorityShares,
        kidsShares,
        adultNullShares,
        titleAgreement,
      },
      falsePositiveReview: fpReview,
      nodes: nodeResults.map(({ scopeIds, ...rest }) => ({
        ...rest,
        scopeCategoryCount: scopeIds.length,
        routedOwnProducts: routedOwn({ ...rest, scopeIds } as any),
      })),
    };

    const dir = path.join(process.env.TEMP || '/tmp', 'auto-map-0');
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, 'auto-map-0-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'auto-map-0-summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8',
    );

    const md: string[] = [
      `# AUTO-MAP-0 dry run (${AUTO_MAP_ENGINE_VERSION})`,
      '',
    ];
    md.push('## Legacy mappings', '');
    md.push(
      '| map | src | path | legacy dest | aud | scope | visible | engine tier | engine rules | rec | disagreements |',
    );
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const l of legacy) {
      md.push(
        `| ${l.mappingId} | ${l.sourceCategoryId} | ${l.localPath} | ${
          l.legacy.canonicalCategoryId
        } ${l.legacy.canonicalPath} | ${l.legacy.rootAudience} | ${
          l.legacy.scopeProducts
        } (${l.legacy.scopeGender.f}f/${l.legacy.scopeGender.m}m/${
          l.legacy.scopeGender.u
        }u/${l.legacy.scopeGender.n}n c${l.legacy.scopeGender.child}) | ${
          l.legacy.visibleUnderCat3b
        } | ${l.engine.tier} | ${l.engine.rules
          .map((x) => `${x.genderSlice}→${x.canonicalCategoryId}`)
          .join(', ')} | ${l.recommendation} | ${l.disagreements.join(
          ', ',
        )} ${l.engine.reasonCodes
          .filter(
            (c) => !c.startsWith('DOMAIN_') && !c.startsWith('CONCEPT_FROM'),
          )
          .join(' ')} ${
          l.engine.contaminatedDescendantIds.length
            ? 'contam:' + l.engine.contaminatedDescendantIds.join(',')
            : ''
        } |`,
      );
    }
    md.push('', '## Product-bearing nodes', '');
    md.push(
      '| id | legacy | path | hierarchy | own (f/m/u/n c) | domain | concept | mode | tier | rules | reasons |',
    );
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of nodeResults) {
      md.push(
        `| ${r.sourceCategoryId} | ${r.legacyMappingIds.join(',')} | ${
          r.localPath
        } | ${r.hierarchy || '-'} | ${r.own.total} (${r.own.female}/${
          r.own.male
        }/${r.own.unisex}/${r.own.nullGender} c${r.own.child}) | ${
          r.domain
        } | ${r.concept || '-'} | ${r.audienceMode} | ${r.tier} | ${r.rules
          .map((x) => `${x.genderSlice}→${x.canonicalCategoryId}`)
          .join(', ')} | ${r.reasonCodes
          .filter(
            (c) => !c.startsWith('DOMAIN_') && !c.startsWith('CONCEPT_FROM'),
          )
          .join(' ')} |`,
      );
    }
    md.push('', '## HIGH false-positive proxy (title concept)', '');
    md.push(
      '| id | name | products | hit | conflict | none | rate | conflict samples |',
    );
    md.push('|---|---|---|---|---|---|---|---|');
    for (const f of fpReview) {
      md.push(
        `| ${f.id} | ${f.name} | ${f.products} | ${f.titleHit} | ${
          f.titleConflict
        } | ${f.titleNoSignal} | ${f.conflictRate} | ${f.conflictSamples.join(
          ' ; ',
        )} |`,
      );
    }
    md.push('', '## Gaps', '');
    for (const g of gaps) {
      md.push(
        `- ${g.concept}: ${g.categories} cats, ${
          g.products
        } products, missing for ${g.missingFor.join('/')}`,
      );
    }
    fs.writeFileSync(
      path.join(dir, 'auto-map-0-digest.md'),
      md.join('\n'),
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary.totals));
    // eslint-disable-next-line no-console
    console.log('WROTE', jsonPath);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
