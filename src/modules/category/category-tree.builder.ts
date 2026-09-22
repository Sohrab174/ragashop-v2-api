/**
 * Read-side category tree builder for public catalog presentation.
 * Does not mutate DB rows. Omits orphans. Guards cycles and depth.
 */

export const CATEGORY_TREE_MAX_DEPTH = 20;
export const CUSTOMER_VISIBLE_MAX_DEPTH = 3;

export type CategoryTreeInput = {
  id: number;
  parentId: number | null;
  name: string;
  iconPath?: string | null;
  gender?: string | null;
  displayOrder?: number;
  presentationImage?: string | null;
  [key: string]: any;
};

export type CategoryTreeNode = CategoryTreeInput & {
  subCategories?: CategoryTreeNode[];
  hasChildren?: boolean;
};

function compareCategories(a: CategoryTreeInput, b: CategoryTreeInput): number {
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

/**
 * Build adjacency tree from a flat active-category list.
 * - Starts only from parentId === null (orphans with missing/inactive parents are omitted)
 * - Skips cycles via ancestor set
 * - Caps recursion depth
 */
export function buildCategoryTree(
  categories: CategoryTreeInput[],
  parentId: number | null = null,
  depth = 0,
  ancestors: Set<number> = new Set(),
  maxDepth = CATEGORY_TREE_MAX_DEPTH,
): CategoryTreeNode[] {
  if (depth > maxDepth) {
    return [];
  }

  const result: CategoryTreeNode[] = [];
  const sorted = [...categories].sort(compareCategories);

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

    const subCategories = buildCategoryTree(
      categories,
      category.id,
      depth + 1,
      nextAncestors,
      maxDepth,
    );

    const node: CategoryTreeNode = {
      ...category,
      hasChildren: subCategories.length > 0,
    };

    if (subCategories.length > 0) {
      node.subCategories = subCategories;
    }

    result.push(node);
  }

  return result;
}

/**
 * Collapse single-child intermediary nodes that add no customer value.
 * Presentation-only; does not mutate source taxonomy rows.
 */
export function collapsePassthroughNodes(
  nodes: CategoryTreeNode[],
): CategoryTreeNode[] {
  const result: CategoryTreeNode[] = [];

  for (const node of nodes) {
    let current = node;
    let children = current.subCategories || [];

    // Skip technical single-child tunnels (max few hops)
    let hops = 0;
    while (children.length === 1 && hops < 5) {
      const only = children[0];
      const grand = only.subCategories || [];
      if (grand.length === 0) {
        break;
      }
      current = {
        ...only,
        // Keep walking from the child that has further structure
      };
      children = grand;
      hops += 1;
    }

    const collapsedChildren = collapsePassthroughNodes(children);
    result.push({
      ...current,
      hasChildren: collapsedChildren.length > 0,
      ...(collapsedChildren.length > 0
        ? { subCategories: collapsedChildren }
        : { subCategories: undefined }),
    });
  }

  return result;
}

/**
 * Cap customer-visible nesting. Deeper nodes become shopping leaves
 * (listing includes descendants via existing product category expansion).
 */
export function applyCustomerVisibleDepth(
  nodes: CategoryTreeNode[],
  depth = 1,
  maxDepth = CUSTOMER_VISIBLE_MAX_DEPTH,
): CategoryTreeNode[] {
  return nodes.map((node) => {
    const children = node.subCategories || [];

    if (depth >= maxDepth || children.length === 0) {
      return {
        ...node,
        hasChildren: false,
        subCategories: undefined,
      };
    }

    const nextChildren = applyCustomerVisibleDepth(
      children,
      depth + 1,
      maxDepth,
    );

    return {
      ...node,
      hasChildren: nextChildren.length > 0,
      subCategories: nextChildren.length > 0 ? nextChildren : undefined,
    };
  });
}

/**
 * Walk tree and collect all category ids.
 */
export function collectCategoryIds(nodes: CategoryTreeNode[]): number[] {
  const ids: number[] = [];

  const walk = (list: CategoryTreeNode[]) => {
    for (const node of list) {
      ids.push(node.id);
      if (node.subCategories?.length) {
        walk(node.subCategories);
      }
    }
  };

  walk(nodes);
  return ids;
}

/**
 * Attach presentationImage map onto every tree node.
 */
export function attachPresentationImages(
  nodes: CategoryTreeNode[],
  imageByCategoryId: Map<number, string | null>,
  fallback: string | null = null,
): CategoryTreeNode[] {
  return nodes.map((node) => {
    const image =
      imageByCategoryId.get(node.id) ||
      node.presentationImage ||
      node.iconPath ||
      fallback;

    const subCategories = node.subCategories?.length
      ? attachPresentationImages(
          node.subCategories,
          imageByCategoryId,
          fallback,
        )
      : undefined;

    return {
      ...node,
      presentationImage: image,
      ...(subCategories ? { subCategories } : {}),
    };
  });
}

/**
 * Fill missing images from descendant presentation images (bottom-up).
 */
export function inheritImagesFromDescendants(
  nodes: CategoryTreeNode[],
): CategoryTreeNode[] {
  return nodes.map((node) => {
    const subCategories = node.subCategories?.length
      ? inheritImagesFromDescendants(node.subCategories)
      : undefined;

    let presentationImage = node.presentationImage || node.iconPath || null;

    if (!presentationImage && subCategories?.length) {
      const childWithImage = subCategories.find((c) => c.presentationImage);
      presentationImage = childWithImage?.presentationImage || null;
    }

    return {
      ...node,
      presentationImage,
      ...(subCategories ? { subCategories } : {}),
    };
  });
}

export function prepareCustomerCatalogTree(
  flatCategories: CategoryTreeInput[],
  options?: { collapsePassthrough?: boolean },
): CategoryTreeNode[] {
  const raw = buildCategoryTree(flatCategories);
  // Default: depth-cap only. Passthrough collapse is optional — aggressive
  // collapsing can hide meaningful department roots.
  const shaped = options?.collapsePassthrough
    ? collapsePassthroughNodes(raw)
    : raw;
  return applyCustomerVisibleDepth(shaped);
}
