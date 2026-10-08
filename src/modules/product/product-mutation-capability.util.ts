/**
 * Field-level capability helpers for ADMIN-RBAC-1 product mutations.
 * Pure decision matrix — enforcement happens via UserCapabilityService.
 */

export type PavPriceQtyFields = {
  price?: number | string | null;
  discountedPrice?: number | string | null;
  quantity?: number | string | null;
};

function isProvided(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function numbersDiffer(a: unknown, b: unknown): boolean {
  return Number(a) !== Number(b);
}

/**
 * True when the request would set/change PAV price or discountedPrice.
 * Omitting the fields never requires product.price.
 */
export function pavMutationRequiresPriceCapability(
  dto: PavPriceQtyFields,
  existing: PavPriceQtyFields | null | undefined,
): boolean {
  if (isProvided(dto.price)) {
    if (!existing || numbersDiffer(dto.price, existing.price)) {
      return true;
    }
  }
  if (isProvided(dto.discountedPrice)) {
    if (
      !existing ||
      numbersDiffer(dto.discountedPrice, existing.discountedPrice)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True when the request would set/change PAV quantity.
 * Omitting quantity lets create path use the DB default (-1) without inventory.
 */
export function pavMutationRequiresInventoryCapability(
  dto: PavPriceQtyFields,
  existing: PavPriceQtyFields | null | undefined,
): boolean {
  if (!isProvided(dto.quantity)) {
    return false;
  }
  if (!existing) {
    return true;
  }
  return numbersDiffer(dto.quantity, existing.quantity);
}

/**
 * Bulk/group status (active/inactive/draft) requires product.disable.
 */
export function groupUpdateRequiresDisableCapability(dto: {
  status?: string | null;
}): boolean {
  return isProvided(dto?.status);
}
