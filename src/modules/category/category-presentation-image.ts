/**
 * Batched presentation-image resolution for catalog cards.
 * Does not copy product images into Category rows.
 */

export type CategoryImageSource = {
  id: number;
  iconPath?: string | null;
  parentId?: number | null;
};

export type ProductCoverRow = {
  categoryId: number;
  pathFile: string;
};

/**
 * Priority:
 * 1) category iconPath
 * 2) direct product cover for that categoryId
 * 3) (caller may inherit from descendants)
 * 4) null → frontend local fallback
 */
export function resolveDirectPresentationImages(
  categories: CategoryImageSource[],
  productCovers: ProductCoverRow[],
): Map<number, string | null> {
  const coverByCategory = new Map<number, string>();
  for (const row of productCovers) {
    if (!coverByCategory.has(row.categoryId) && row.pathFile) {
      coverByCategory.set(Number(row.categoryId), row.pathFile);
    }
  }

  const result = new Map<number, string | null>();
  for (const category of categories) {
    if (category.iconPath) {
      result.set(category.id, category.iconPath);
    } else if (coverByCategory.has(category.id)) {
      result.set(category.id, coverByCategory.get(category.id) || null);
    } else {
      result.set(category.id, null);
    }
  }

  return result;
}

/**
 * For categories still missing an image, prefer any descendant cover
 * using parent→children adjacency from the flat list.
 */
export function fillImagesFromDescendantCovers(
  categories: CategoryImageSource[],
  imageByCategoryId: Map<number, string | null>,
  productCovers: ProductCoverRow[],
): Map<number, string | null> {
  const result = new Map(imageByCategoryId);
  const childrenByParent = new Map<number | null, number[]>();

  for (const category of categories) {
    const parentKey =
      category.parentId == null ? null : Number(category.parentId);
    const list = childrenByParent.get(parentKey) || [];
    list.push(category.id);
    childrenByParent.set(parentKey, list);
  }

  const coverByCategory = new Map<number, string>();
  for (const row of productCovers) {
    if (!coverByCategory.has(row.categoryId) && row.pathFile) {
      coverByCategory.set(Number(row.categoryId), row.pathFile);
    }
  }

  const findDescendantImage = (
    categoryId: number,
    visited: Set<number>,
  ): string | null => {
    if (visited.has(categoryId)) {
      return null;
    }
    visited.add(categoryId);

    const existing = result.get(categoryId);
    if (existing) {
      return existing;
    }

    const direct = coverByCategory.get(categoryId);
    if (direct) {
      return direct;
    }

    const children = childrenByParent.get(categoryId) || [];
    for (const childId of children) {
      const found = findDescendantImage(childId, visited);
      if (found) {
        return found;
      }
    }

    return null;
  };

  for (const category of categories) {
    if (!result.get(category.id)) {
      result.set(
        category.id,
        findDescendantImage(category.id, new Set<number>()),
      );
    }
  }

  return result;
}
