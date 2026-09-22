/**
 * Read-side builder for RagaShop canonical storefront navigation.
 * Cycle-safe, depth-capped, deterministically ordered.
 */

export const CANONICAL_TREE_MAX_DEPTH = 20;
export const CANONICAL_CUSTOMER_VISIBLE_MAX_DEPTH = 3;

export type CanonicalTreeInput = {
  id: number;
  parentId: number | null;
  name: string;
  imagePath?: string | null;
  displayOrder?: number;
  [key: string]: unknown;
};

/** Public storefront navigation node — no source/import metadata. */
export type StorefrontNavigationNode = {
  id: number;
  name: string;
  image: string | null;
  hasChildren: boolean;
  children?: StorefrontNavigationNode[];
};

function compareCanonical(
  a: CanonicalTreeInput,
  b: CanonicalTreeInput,
): number {
  const orderA = a.displayOrder ?? 0;
  const orderB = b.displayOrder ?? 0;
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  if (a.id !== b.id) {
    return a.id - b.id;
  }
  return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
}

type InternalNode = CanonicalTreeInput & {
  hasChildren: boolean;
  children?: InternalNode[];
};

/**
 * Build adjacency tree from flat active canonical rows.
 * Starts at parentId === null; omits orphans; guards cycles and depth.
 */
export function buildCanonicalTree(
  categories: CanonicalTreeInput[],
  parentId: number | null = null,
  depth = 0,
  ancestors: Set<number> = new Set(),
  maxDepth = CANONICAL_TREE_MAX_DEPTH,
): InternalNode[] {
  if (depth > maxDepth) {
    return [];
  }

  const result: InternalNode[] = [];
  const sorted = [...categories].sort(compareCanonical);

  for (const category of sorted) {
    const matchesParent =
      parentId == null
        ? category.parentId == null
        : Number(category.parentId) === Number(parentId);

    if (!matchesParent) {
      continue;
    }

    if (ancestors.has(category.id)) {
      continue;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(category.id);

    const children = buildCanonicalTree(
      categories,
      category.id,
      depth + 1,
      nextAncestors,
      maxDepth,
    );

    const node: InternalNode = {
      ...category,
      hasChildren: children.length > 0,
    };

    if (children.length > 0) {
      node.children = children;
    }

    result.push(node);
  }

  return result;
}

/**
 * Cap customer-visible nesting. Deeper structure becomes leaves.
 */
export function applyCanonicalVisibleDepth(
  nodes: InternalNode[],
  depth = 1,
  maxDepth = CANONICAL_CUSTOMER_VISIBLE_MAX_DEPTH,
): InternalNode[] {
  return [...nodes].sort(compareCanonical).map((node) => {
    const children = node.children ?? [];

    if (depth >= maxDepth || children.length === 0) {
      const leaf: InternalNode = {
        ...node,
        hasChildren: false,
      };
      delete leaf.children;
      return leaf;
    }

    const nextChildren = applyCanonicalVisibleDepth(
      children,
      depth + 1,
      maxDepth,
    );

    return {
      ...node,
      hasChildren: nextChildren.length > 0,
      children: nextChildren.length > 0 ? nextChildren : undefined,
    };
  });
}

/** Strip internal fields; expose only navigation contract. */
export function toStorefrontNavigation(
  nodes: InternalNode[],
): StorefrontNavigationNode[] {
  return nodes.map((node) => {
    const out: StorefrontNavigationNode = {
      id: node.id,
      name: node.name,
      image: (node.imagePath as string | null | undefined) ?? null,
      hasChildren: Boolean(node.hasChildren),
    };
    if (node.children?.length) {
      out.children = toStorefrontNavigation(node.children);
    }
    return out;
  });
}

export function prepareStorefrontNavigationTree(
  categories: CanonicalTreeInput[],
  maxVisibleDepth = CANONICAL_CUSTOMER_VISIBLE_MAX_DEPTH,
): StorefrontNavigationNode[] {
  const tree = buildCanonicalTree(categories);
  const capped = applyCanonicalVisibleDepth(tree, 1, maxVisibleDepth);
  return toStorefrontNavigation(capped);
}
