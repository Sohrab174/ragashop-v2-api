/**
 * AUTO-MAP-0 — shared node evaluation context (pure; no I/O).
 *
 * Used by the read-only analyze script and by Admin coverage so AUTO-MAP
 * tiers are computed by exactly one implementation.
 */
import { expandSourceCategoryIds } from './canonical-category-scope.resolver';
import {
  accumulateProduct,
  AutoMapProposal,
  buildCanonicalConceptIndex,
  CanonicalInput,
  emptyNodeDistribution,
  mergeDistributions,
  NodeDistribution,
  proposeForNode,
  SourceNodeInput,
} from './auto-map-0.matcher';

export type AutoMapProductRow = {
  id: number;
  categoryId: number;
  gender: string | null;
  ageGroup: string | null;
  sourceName: string | null;
};

export function buildAutoMapContext<P extends AutoMapProductRow>(input: {
  canonicals: CanonicalInput[];
  categories: SourceNodeInput[];
  products: P[];
}) {
  const { canonicals, categories, products } = input;
  const catById = new Map(categories.map((c) => [Number(c.id), c]));
  const canonById = new Map(canonicals.map((c) => [Number(c.id), c]));
  const { index: canonicalIndex, unknownLabels } =
    buildCanonicalConceptIndex(canonicals);

  const sourcePath = (id: number): SourceNodeInput[] => {
    const out: SourceNodeInput[] = [];
    const seen = new Set<number>();
    let cur = catById.get(id);
    while (cur && !seen.has(Number(cur.id))) {
      seen.add(Number(cur.id));
      out.unshift(cur);
      cur =
        cur.parentId != null ? catById.get(Number(cur.parentId)) : undefined;
    }
    return out;
  };
  const canonPath = (id: number): CanonicalInput[] => {
    const out: CanonicalInput[] = [];
    const seen = new Set<number>();
    let cur = canonById.get(id);
    while (cur && !seen.has(Number(cur.id))) {
      seen.add(Number(cur.id));
      out.unshift(cur);
      cur =
        cur.parentId != null ? canonById.get(Number(cur.parentId)) : undefined;
    }
    return out;
  };

  const ownDist = new Map<number, NodeDistribution>();
  const titlesByCat = new Map<number, string[]>();
  const productsByCat = new Map<number, P[]>();
  for (const p of products) {
    const cid = Number(p.categoryId);
    const d = ownDist.get(cid) || emptyNodeDistribution();
    accumulateProduct(d, p);
    ownDist.set(cid, d);
    const t = titlesByCat.get(cid) || [];
    t.push(String(p.sourceName || ''));
    titlesByCat.set(cid, t);
    const list = productsByCat.get(cid) || [];
    list.push(p);
    productsByCat.set(cid, list);
  }

  const taxonomy = categories.map((c) => ({
    id: Number(c.id),
    parentId: c.parentId != null ? Number(c.parentId) : null,
    source: c.source,
    status: c.status,
  }));

  const scopeOf = (id: number, source: string | null) =>
    expandSourceCategoryIds([{ sourceCategoryId: id, source }], taxonomy);

  const evaluate = (id: number): AutoMapProposal & { scopeIds: number[] } => {
    const node = catById.get(id)!;
    const scopeIds = scopeOf(id, node.source);
    const scopeDist = emptyNodeDistribution();
    for (const sid of scopeIds) {
      const d = ownDist.get(sid);
      if (d) mergeDistributions(scopeDist, d);
    }
    const descendants = scopeIds
      .filter((sid) => sid !== id)
      .map((sid) => ({
        node: catById.get(sid)!,
        products: ownDist.get(sid)?.total || 0,
      }))
      .filter((d) => d.node);
    const chain = sourcePath(id);
    const proposal = proposeForNode({
      node,
      pathRootSourceName: chain[0]?.sourceName ?? null,
      pathLabels: chain.map((c) => c.sourceName || c.name || ''),
      scopeDist,
      descendants,
      canonicalIndex,
      orphanParent:
        node.parentId != null && !catById.has(Number(node.parentId)),
    });
    return { ...proposal, scopeIds };
  };

  /** Own products routed by a proposal's slices (no scope double counting). */
  const routedOwnProductIds = (
    sourceCategoryId: number,
    rules: Array<{ genderSlice: string }>,
  ): number[] => {
    const slices = new Set(rules.map((x) => x.genderSlice));
    const out: number[] = [];
    for (const p of productsByCat.get(sourceCategoryId) || []) {
      if (
        slices.has('any') ||
        (slices.has('female') &&
          (p.gender === 'female' || p.gender === 'unisex')) ||
        (slices.has('male') && (p.gender === 'male' || p.gender === 'unisex'))
      )
        out.push(p.id);
    }
    return out;
  };

  const productNodes = [...ownDist.keys()]
    .filter((id) => catById.has(id))
    .sort((a, b) => a - b);

  return {
    catById,
    canonById,
    canonicalIndex,
    unknownLabels,
    sourcePath,
    canonPath,
    ownDist,
    titlesByCat,
    productsByCat,
    taxonomy,
    scopeOf,
    evaluate,
    routedOwnProductIds,
    productNodes,
    totalDiscoverable: products.length,
  };
}
