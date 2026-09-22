import { ProductSupplyType } from './catalog-lifecycle.types';

export type CatalogMembershipSnapshot = {
  supplyType: ProductSupplyType | string;
  isCuratedExternalCatalog: boolean;
};

/**
 * After customer paste-link success:
 * ensure external supply; NEVER touch curated membership.
 * New products keep DB default curated=false; existing curated stay curated.
 */
export function membershipPatchForCustomerImportSuccess(): Partial<CatalogMembershipSnapshot> {
  return {
    supplyType: ProductSupplyType.external_source,
  };
}

/**
 * After scheduled/catalog refresh success:
 * ensure external supply only — do not promote or demote curated.
 */
export function membershipPatchForScheduledImportSuccess(): Partial<CatalogMembershipSnapshot> {
  return {
    supplyType: ProductSupplyType.external_source,
  };
}

/**
 * Explicit catalog-managed intake / promotion helper.
 * Not used by customer paste-link success path.
 */
export function membershipPatchForCatalogManagedImport(): Partial<CatalogMembershipSnapshot> {
  return {
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
  };
}

/** Promote an external product into the curated discovery pool. */
export function promoteExternalToCurated(
  current: CatalogMembershipSnapshot,
): CatalogMembershipSnapshot {
  if (current.supplyType === ProductSupplyType.native_marketplace) {
    return { ...current };
  }
  return {
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
  };
}

/** Retire from curated pool without deleting the Product. */
export function retireExternalFromCurated(
  current: CatalogMembershipSnapshot,
): CatalogMembershipSnapshot {
  return {
    supplyType:
      current.supplyType === ProductSupplyType.native_marketplace
        ? current.supplyType
        : ProductSupplyType.external_source,
    isCuratedExternalCatalog: false,
  };
}

export function isCuratedExternalMember(
  current: CatalogMembershipSnapshot,
): boolean {
  return (
    current.supplyType === ProductSupplyType.external_source &&
    current.isCuratedExternalCatalog === true
  );
}
