/**
 * READ-ONLY TAXONOMY-SCOPE-1 forensic: draft assortment policy over source
 * categories, crossed with the AUTO-MAP-0 dry run.
 *
 * Usage (from ragashop-api):
 *   npm run catalog:auto-map:analyze        # produces the AUTO-MAP-0 report
 *   npm run catalog:taxonomy-scope:analyze
 *
 * SELECT queries only. Never writes to the database. The rule table below is
 * a DRAFT of what would later live in a policy table; nothing reads it at
 * runtime.
 */
import { createConnection } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

type PolicyStatus = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'REVIEW_REQUIRED';

type PolicyRule = {
  provider: string;
  pathPrefix: string;
  status: PolicyStatus;
  reason: string;
  businessDomain: string;
};

const DRAFT_RULES: PolicyRule[] = [
  // Target assortment.
  {
    provider: 'trendyol',
    pathPrefix: 'Giyim',
    status: 'IN_SCOPE',
    reason: 'TARGET_FASHION',
    businessDomain: 'fashion_apparel',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Clothing',
    status: 'IN_SCOPE',
    reason: 'TARGET_FASHION',
    businessDomain: 'fashion_apparel',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ayakkabı',
    status: 'IN_SCOPE',
    reason: 'TARGET_FASHION',
    businessDomain: 'fashion_shoes',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Shoes',
    status: 'IN_SCOPE',
    reason: 'TARGET_FASHION',
    businessDomain: 'fashion_shoes',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Aksesuar',
    status: 'IN_SCOPE',
    reason: 'TARGET_ACCESSORY',
    businessDomain: 'fashion_accessories_bags',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Kozmetik & Kişisel Bakım',
    status: 'IN_SCOPE',
    reason: 'TARGET_BEAUTY',
    businessDomain: 'beauty',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Cosmetics & Personal Care',
    status: 'IN_SCOPE',
    reason: 'TARGET_BEAUTY',
    businessDomain: 'beauty',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Spor & Outdoor',
    status: 'IN_SCOPE',
    reason: 'TARGET_EXISTING_CANONICAL_ROOT',
    businessDomain: 'sport',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Elektronik',
    status: 'IN_SCOPE',
    reason: 'TARGET_EXISTING_CANONICAL_ROOT',
    businessDomain: 'electronics',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Anne & Bebek & Çocuk/Çocuk Gereçleri/Bebek Bakım Çantası',
    status: 'IN_SCOPE',
    reason: 'TARGET_ACCESSORY',
    businessDomain: 'fashion_accessories_bags',
  },

  // Structurally bulky / heavy.
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Mobilya',
    status: 'OUT_OF_SCOPE',
    reason: 'BULKY_FURNITURE',
    businessDomain: 'home_furniture',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Ev/Ev Gereçleri/Ütü Masası ve Aksesuarı',
    status: 'OUT_OF_SCOPE',
    reason: 'BULKY_HEAVY',
    businessDomain: 'home_bulky_utility',
  },
  {
    provider: 'trendyol',
    pathPrefix:
      'Ev & Mobilya/Ev/Ev Gereçleri/Çamaşırlık Ev Gereçleri/Çamaşır Kurutmalık',
    status: 'OUT_OF_SCOPE',
    reason: 'BULKY_HEAVY',
    businessDomain: 'home_bulky_utility',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Ev/Ev Gereçleri/Pazar Arabası & Çantası',
    status: 'OUT_OF_SCOPE',
    reason: 'BULKY_HEAVY',
    businessDomain: 'home_bulky_utility',
  },

  // Business decision required (never silently excluded).
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Ev',
    status: 'REVIEW_REQUIRED',
    reason: 'HOME_GOODS_NOT_YET_DECIDED',
    businessDomain: 'home_goods_small',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Mobilya/Halı / Kilim',
    status: 'REVIEW_REQUIRED',
    reason: 'HEAVY_TEXTILE_SIZE_UNKNOWN',
    businessDomain: 'home_rugs',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Mobilya/Perde',
    status: 'REVIEW_REQUIRED',
    reason: 'HOME_GOODS_NOT_YET_DECIDED',
    businessDomain: 'home_curtains',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Mobilya/Elektrik & Aydınlatma',
    status: 'REVIEW_REQUIRED',
    reason: 'FRAGILE_OR_BULKY',
    businessDomain: 'home_lighting',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Ev & Mobilya/Mobilya/Bahçe Mobilyaları/Bahçe Minderi',
    status: 'REVIEW_REQUIRED',
    reason: 'HOME_GOODS_NOT_YET_DECIDED',
    businessDomain: 'home_goods_small',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Giyim/Fantezi Giyim',
    status: 'REVIEW_REQUIRED',
    reason: 'SENSITIVE_ADULT',
    businessDomain: 'sensitive',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Süpermarket',
    status: 'REVIEW_REQUIRED',
    reason: 'NOT_TARGETED_YET',
    businessDomain: 'other',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Süpermarket/Sağlık/Cinsel Sağlık',
    status: 'REVIEW_REQUIRED',
    reason: 'SENSITIVE_ADULT',
    businessDomain: 'sensitive',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Anne & Bebek & Çocuk',
    status: 'REVIEW_REQUIRED',
    reason: 'KIDS_GOODS_NOT_YET_DECIDED',
    businessDomain: 'kids_goods_toys',
  },
  {
    provider: 'trendyol',
    pathPrefix:
      'Anne & Bebek & Çocuk/Çocuk Gereçleri/Oto Koltuğu ve Aksesuarları',
    status: 'REVIEW_REQUIRED',
    reason: 'SAFETY_REGULATED',
    businessDomain: 'kids_goods_toys',
  },
  {
    provider: 'trendyol',
    pathPrefix:
      'Spor & Outdoor/Ekipman & Aksesuar/Bisiklet & Aksesuar/Bisiklet',
    status: 'REVIEW_REQUIRED',
    reason: 'BULKY_EXISTING_CANONICAL',
    businessDomain: 'sport_bulky',
  },
  {
    provider: 'trendyol',
    pathPrefix:
      'Spor & Outdoor/Ekipman & Aksesuar/Elektrikli Bisiklet & Aksesuar',
    status: 'REVIEW_REQUIRED',
    reason: 'BULKY_BATTERY_EXISTING_CANONICAL',
    businessDomain: 'sport_bulky',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Kırtasiye & Ofis Malzemeleri',
    status: 'REVIEW_REQUIRED',
    reason: 'NOT_TARGETED_YET',
    businessDomain: 'other',
  },
  {
    provider: 'trendyol',
    pathPrefix: 'Hobi & Eğlence',
    status: 'REVIEW_REQUIRED',
    reason: 'NOT_TARGETED_YET',
    businessDomain: 'other',
  },
];

/** Fallback for nodes without any provider path in their own subtree. */
const DOMAIN_DEFAULT: Record<
  string,
  { status: PolicyStatus; businessDomain: string }
> = {
  clothing: { status: 'IN_SCOPE', businessDomain: 'fashion_apparel' },
  sportswear: { status: 'IN_SCOPE', businessDomain: 'fashion_apparel' },
  shoe: { status: 'IN_SCOPE', businessDomain: 'fashion_shoes' },
  accessory: { status: 'IN_SCOPE', businessDomain: 'fashion_accessories_bags' },
  beauty: { status: 'IN_SCOPE', businessDomain: 'beauty' },
  sport: { status: 'IN_SCOPE', businessDomain: 'sport' },
  electronics: { status: 'IN_SCOPE', businessDomain: 'electronics' },
};

type CategoryRow = {
  id: number;
  parentId: number | null;
  source: string | null;
  sourceName: string | null;
  name: string | null;
  hierarchy: string | null;
  status: string;
};

type PolicyDecision = {
  status: PolicyStatus;
  reason: string;
  businessDomain: string;
  via: 'provider_path' | 'descendants' | 'domain_default' | 'unclassified';
  rule: string | null;
};

type ReportNode = {
  sourceCategoryId: number;
  domain: string;
  concept: string | null;
  tier: string;
  audienceMode: string;
  own: { total: number };
  routedOwnProducts: number;
  legacyMappingIds: number[];
  hierarchy: string | null;
  localPath: string;
  sourceName: string;
};

const norm = (s: string) =>
  s
    .split('/')
    .map((x) => x.trim().toLocaleLowerCase('tr'))
    .filter(Boolean);

function matchRule(provider: string, hierarchy: string): PolicyRule | null {
  const segs = norm(hierarchy);
  let best: PolicyRule | null = null;
  let bestLen = -1;
  for (const rule of DRAFT_RULES) {
    if (rule.provider !== provider) continue;
    const pre = norm(rule.pathPrefix);
    if (pre.length > segs.length || pre.length <= bestLen) continue;
    if (pre.every((p, i) => p === segs[i])) {
      best = rule;
      bestLen = pre.length;
    }
  }
  return best;
}

const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 10000) / 100 : 0;

async function main() {
  const reportPath =
    process.env.AUTO_MAP_REPORT ||
    path.join(
      process.env.TEMP || '/tmp',
      'auto-map-0',
      'auto-map-0-report.json',
    );
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const nodes: ReportNode[] = report.nodes;
  const nodeById = new Map(nodes.map((n) => [Number(n.sourceCategoryId), n]));

  const conn = await createConnection();
  try {
    const categories: CategoryRow[] = await conn.query(
      `SELECT id, parentId, source, sourceName, name, hierarchy, status
       FROM category ORDER BY id`,
    );
    const liveRows: Array<{
      categoryId: number;
      live: string;
      active: string;
      external: string;
    }> = await conn.query(
      `SELECT categoryId, COUNT(*) live, SUM(status = 'active') active,
              SUM(supplyType = 'external_source' AND isCuratedExternalCatalog = 1) external
       FROM product WHERE isDeleted = 0 GROUP BY categoryId`,
    );
    const galleryRows: Array<{ categoryId: number; n: string }> =
      await conn.query(
        `SELECT p.categoryId, COUNT(*) n FROM product_gallery g
         JOIN product p ON p.id = g.productId
         WHERE p.isDeleted = 0 GROUP BY p.categoryId`,
      );
    const pavRows: Array<{ categoryId: number; n: string }> = await conn.query(
      `SELECT p.categoryId, COUNT(*) n FROM product_attribute_value v
       JOIN product p ON p.id = v.productId
       WHERE p.isDeleted = 0 GROUP BY p.categoryId`,
    );
    const live = new Map(liveRows.map((r) => [Number(r.categoryId), r]));
    const gallery = new Map(
      galleryRows.map((r) => [Number(r.categoryId), Number(r.n)]),
    );
    const pav = new Map(
      pavRows.map((r) => [Number(r.categoryId), Number(r.n)]),
    );

    const byId = new Map(categories.map((c) => [Number(c.id), c]));
    const children = new Map<number, number[]>();
    for (const c of categories) {
      if (c.parentId == null) continue;
      const list = children.get(Number(c.parentId)) || [];
      list.push(Number(c.id));
      children.set(Number(c.parentId), list);
    }
    const subtreeLive = new Map<number, number>();
    const subtreeLiveOf = (id: number): number => {
      if (subtreeLive.has(id)) return subtreeLive.get(id) as number;
      const own = Number(live.get(id)?.live || 0);
      const total = (children.get(id) || []).reduce(
        (s, k) => s + subtreeLiveOf(k),
        own,
      );
      subtreeLive.set(id, total);
      return total;
    };

    const decisions = new Map<number, PolicyDecision>();
    const decide = (id: number): PolicyDecision => {
      const cached = decisions.get(id);
      if (cached) return cached;
      const c = byId.get(id) as CategoryRow;
      let d: PolicyDecision | null = null;
      if (c.hierarchy && c.source) {
        const rule = matchRule(c.source, c.hierarchy);
        if (rule) {
          d = {
            status: rule.status,
            reason: rule.reason,
            businessDomain: rule.businessDomain,
            via: 'provider_path',
            rule: rule.pathPrefix,
          };
        }
      }
      if (!d) {
        const kids = (children.get(id) || []).map((k) => ({
          d: decide(k),
          weight: subtreeLiveOf(k),
        }));
        const informative = kids.filter(
          (k) => k.d.via !== 'unclassified' && k.weight > 0,
        );
        if (informative.length) {
          const statuses = new Set(informative.map((k) => k.d.status));
          const top = informative.sort((a, b) => b.weight - a.weight)[0].d;
          const ownDomain = nodeById.get(id)?.domain;
          const businessDomain =
            (ownDomain && DOMAIN_DEFAULT[ownDomain]?.businessDomain) ||
            top.businessDomain;
          d =
            statuses.size === 1
              ? { ...top, businessDomain, via: 'descendants', rule: null }
              : {
                  status: 'REVIEW_REQUIRED',
                  reason: 'MIXED_DESCENDANT_POLICY',
                  businessDomain,
                  via: 'descendants',
                  rule: null,
                };
        }
      }
      if (!d) {
        const node = nodeById.get(id);
        const def = node ? DOMAIN_DEFAULT[node.domain] : undefined;
        d = def
          ? {
              status: def.status,
              reason: 'DOMAIN_DEFAULT',
              businessDomain: def.businessDomain,
              via: 'domain_default',
              rule: null,
            }
          : {
              status: 'REVIEW_REQUIRED',
              reason: 'UNCLASSIFIED',
              businessDomain: 'unknown',
              via: 'unclassified',
              rule: null,
            };
      }
      decisions.set(id, d);
      return d;
    };
    for (const c of categories) decide(Number(c.id));

    // ── All 660 categories by policy ──────────────────────────────────────
    const allCats: Record<
      string,
      { categories: number; withLiveProducts: number; liveProducts: number }
    > = {};
    for (const c of categories) {
      const d = decisions.get(Number(c.id)) as PolicyDecision;
      const k = d.status;
      allCats[k] = allCats[k] || {
        categories: 0,
        withLiveProducts: 0,
        liveProducts: 0,
      };
      allCats[k].categories++;
      const n = Number(live.get(Number(c.id))?.live || 0);
      if (n > 0) allCats[k].withLiveProducts++;
      allCats[k].liveProducts += n;
    }

    // ── NO_DESTINATION reclassification ───────────────────────────────────
    const classOf = (s: PolicyStatus) =>
      s === 'OUT_OF_SCOPE'
        ? 'OUT_OF_CATALOG_SCOPE'
        : s === 'IN_SCOPE'
        ? 'IN_SCOPE_MISSING_DESTINATION'
        : 'NEEDS_BUSINESS_DECISION';
    const noDest = nodes.filter((n) => n.tier === 'NO_DESTINATION');
    const noDestClass: Record<
      string,
      { categories: number; products: number }
    > = {};
    const noDestDomain: Record<
      string,
      { categories: number; products: number }
    > = {};
    const noDestRows = noDest
      .map((n) => {
        const d = decisions.get(Number(n.sourceCategoryId)) as PolicyDecision;
        const cls = classOf(d.status);
        noDestClass[cls] = noDestClass[cls] || { categories: 0, products: 0 };
        noDestClass[cls].categories++;
        noDestClass[cls].products += n.own.total;
        const dk = `${cls} | ${d.businessDomain}`;
        noDestDomain[dk] = noDestDomain[dk] || { categories: 0, products: 0 };
        noDestDomain[dk].categories++;
        noDestDomain[dk].products += n.own.total;
        return {
          id: n.sourceCategoryId,
          products: n.own.total,
          class: cls,
          reason: d.reason,
          businessDomain: d.businessDomain,
          via: d.via,
          concept: n.concept,
          audienceMode: n.audienceMode,
          path: n.hierarchy || n.localPath,
          legacy: n.legacyMappingIds,
        };
      })
      .sort((a, b) => b.products - a.products);

    // ── Coverage: total vs in-scope ───────────────────────────────────────
    const totalDiscoverable = nodes.reduce((s, n) => s + n.own.total, 0);
    const byStatus: Record<string, { categories: number; products: number }> =
      {};
    const inScopeTier: Record<
      string,
      { categories: number; products: number; routable: number }
    > = {};
    for (const n of nodes) {
      const d = decisions.get(Number(n.sourceCategoryId)) as PolicyDecision;
      byStatus[d.status] = byStatus[d.status] || { categories: 0, products: 0 };
      byStatus[d.status].categories++;
      byStatus[d.status].products += n.own.total;
      if (d.status !== 'IN_SCOPE') continue;
      inScopeTier[n.tier] = inScopeTier[n.tier] || {
        categories: 0,
        products: 0,
        routable: 0,
      };
      inScopeTier[n.tier].categories++;
      inScopeTier[n.tier].products += n.own.total;
      inScopeTier[n.tier].routable += n.routedOwnProducts;
    }
    const inScope = byStatus.IN_SCOPE?.products || 0;
    const t = (k: string) =>
      inScopeTier[k] || { categories: 0, products: 0, routable: 0 };
    const inScopeCoverage = {
      inScopeProducts: inScope,
      highRoutable: t('AUTO_MAP_HIGH_CONFIDENCE').routable,
      highPct: pct(t('AUTO_MAP_HIGH_CONFIDENCE').routable, inScope),
      highPlusSuggestRoutable:
        t('AUTO_MAP_HIGH_CONFIDENCE').routable +
        t('AUTO_SUGGEST_REVIEW').routable,
      highPlusSuggestPct: pct(
        t('AUTO_MAP_HIGH_CONFIDENCE').routable +
          t('AUTO_SUGGEST_REVIEW').routable,
        inScope,
      ),
      humanProducts: t('HUMAN_REVIEW_REQUIRED').products,
      humanPct: pct(t('HUMAN_REVIEW_REQUIRED').products, inScope),
      blockedProducts: t('DATA_QUALITY_BLOCKED').products,
      blockedPct: pct(t('DATA_QUALITY_BLOCKED').products, inScope),
      missingDestinationProducts: t('NO_DESTINATION').products,
      missingDestinationPct: pct(t('NO_DESTINATION').products, inScope),
    };

    // ── Legacy mappings touching non-IN_SCOPE nodes ───────────────────────
    const legacyLeak: Array<Record<string, unknown>> = [];
    for (const n of nodes) {
      const d = decisions.get(Number(n.sourceCategoryId)) as PolicyDecision;
      if (d.status === 'IN_SCOPE' || !n.legacyMappingIds.length) continue;
      legacyLeak.push({
        id: n.sourceCategoryId,
        path: n.hierarchy || n.localPath,
        products: n.own.total,
        status: d.status,
        reason: d.reason,
        legacyMappingIds: n.legacyMappingIds,
        engineTier: n.tier,
      });
    }

    // ── Storage / refresh footprint by policy ─────────────────────────────
    const footprint: Record<string, Record<string, number>> = {};
    for (const c of categories) {
      const d = decisions.get(Number(c.id)) as PolicyDecision;
      const key = `${d.status} | ${d.businessDomain}`;
      const f = (footprint[key] = footprint[key] || {
        categories: 0,
        liveProducts: 0,
        activeProducts: 0,
        externalCurated: 0,
        galleryRows: 0,
        attributeValueRows: 0,
      });
      const l = live.get(Number(c.id));
      f.categories++;
      f.liveProducts += Number(l?.live || 0);
      f.activeProducts += Number(l?.active || 0);
      f.externalCurated += Number(l?.external || 0);
      f.galleryRows += gallery.get(Number(c.id)) || 0;
      f.attributeValueRows += pav.get(Number(c.id)) || 0;
    }

    const summary = {
      draftRules: DRAFT_RULES.length,
      allCategoriesByPolicy: allCats,
      productBearingByPolicy: byStatus,
      totalDiscoverable,
      noDestinationByClass: noDestClass,
      noDestinationByClassDomain: noDestDomain,
      inScopeTier,
      inScopeCoverage,
      legacyLeak,
      footprint,
    };
    const outDir = path.join(process.env.TEMP || '/tmp', 'taxonomy-scope-1');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'taxonomy-scope-1-summary.json'),
      JSON.stringify(summary, null, 1),
    );
    fs.writeFileSync(
      path.join(outDir, 'taxonomy-scope-1-nodest.json'),
      JSON.stringify(noDestRows, null, 1),
    );
    const decisionRows = categories.map((c) => ({
      id: c.id,
      source: c.source,
      path: c.hierarchy,
      sourceName: c.sourceName,
      live: Number(live.get(Number(c.id))?.live || 0),
      discoverable: nodeById.get(Number(c.id))?.own.total || 0,
      engineTier: nodeById.get(Number(c.id))?.tier || null,
      ...decisions.get(Number(c.id)),
    }));
    fs.writeFileSync(
      path.join(outDir, 'taxonomy-scope-1-decisions.json'),
      JSON.stringify(decisionRows, null, 1),
    );
    console.log(
      JSON.stringify({
        totalDiscoverable,
        byStatus,
        noDestClass,
        inScopeCoverage,
      }),
    );
    console.log(`WROTE ${outDir}`);
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
