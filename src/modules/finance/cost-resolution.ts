import { ProductCurrency } from '../product/entities/product.entity';
import { CostSource, OrderItemCogsStatus } from './finance.types';

export type CostBearing = {
  purchaseCost: number | null | undefined;
  landedUnitCost: number | null | undefined;
  costCurrency: ProductCurrency | null | undefined;
  costSource: CostSource | null | undefined;
};

export type EffectiveCostLine = {
  purchaseCost: number | null;
  landedUnitCost: number | null;
  costCurrency: ProductCurrency | null;
  costSource: CostSource | null;
  cogsStatus: OrderItemCogsStatus;
};

type SelectedCost = {
  value: number | null;
  currency: ProductCurrency | null;
  source: CostSource | null;
};

/**
 * Explicit null/undefined = absent. Zero is a valid configured cost.
 * No silent fallback from sell price or purchase→landed.
 */
export function isPresentCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Pick override or base for one cost field. Currency stays bound to the
 * source that supplied the numeric value — never inherited across fields.
 */
function pickCostWithCurrency(
  overrideValue: number | null | undefined,
  overrideCurrency: ProductCurrency | null | undefined,
  overrideSource: CostSource | null | undefined,
  baseValue: number | null | undefined,
  baseCurrency: ProductCurrency | null | undefined,
  baseSource: CostSource | null | undefined,
): SelectedCost {
  if (isPresentCost(overrideValue)) {
    return {
      value: overrideValue,
      currency: overrideCurrency ?? null,
      source: overrideSource ?? null,
    };
  }
  if (isPresentCost(baseValue)) {
    return {
      value: baseValue,
      currency: baseCurrency ?? null,
      source: baseSource ?? null,
    };
  }
  return { value: null, currency: null, source: null };
}

/**
 * Resolve effective purchase + landed cost for a Product with optional PAV override.
 * PAV field wins when explicitly populated (including 0); null/undefined inherits Product.
 *
 * Single OrderItem.costCurrency cannot describe two currencies. If effective
 * purchase and landed resolve to different currencies (or a present cost lacks
 * currency), fail closed: keep numeric evidence, null shared currency, cogs missing.
 */
export function resolveEffectiveCost(
  product: CostBearing,
  pav: CostBearing | null | undefined,
): EffectiveCostLine {
  const purchase = pickCostWithCurrency(
    pav?.purchaseCost,
    pav?.costCurrency,
    pav?.costSource,
    product.purchaseCost,
    product.costCurrency,
    product.costSource,
  );
  const landed = pickCostWithCurrency(
    pav?.landedUnitCost,
    pav?.costCurrency,
    pav?.costSource,
    product.landedUnitCost,
    product.costCurrency,
    product.costSource,
  );

  const purchaseCost = purchase.value;
  const landedUnitCost = landed.value;

  if (purchaseCost == null && landedUnitCost == null) {
    return {
      purchaseCost: null,
      landedUnitCost: null,
      costCurrency: null,
      costSource: null,
      cogsStatus: OrderItemCogsStatus.missing,
    };
  }

  const currenciesPresent: ProductCurrency[] = [];
  if (purchaseCost != null) {
    if (purchase.currency == null) {
      return {
        purchaseCost,
        landedUnitCost,
        costCurrency: null,
        costSource: landed.source ?? purchase.source,
        cogsStatus: OrderItemCogsStatus.missing,
      };
    }
    currenciesPresent.push(purchase.currency);
  }
  if (landedUnitCost != null) {
    if (landed.currency == null) {
      return {
        purchaseCost,
        landedUnitCost,
        costCurrency: null,
        costSource: landed.source ?? purchase.source,
        cogsStatus: OrderItemCogsStatus.missing,
      };
    }
    currenciesPresent.push(landed.currency);
  }

  const unique = Array.from(new Set(currenciesPresent));
  if (unique.length > 1) {
    // Partial PAV override must not relabel the inherited sibling cost.
    return {
      purchaseCost,
      landedUnitCost,
      costCurrency: null,
      costSource: landed.source ?? purchase.source,
      cogsStatus: OrderItemCogsStatus.missing,
    };
  }

  const costCurrency = unique[0] ?? null;
  const costSource = landedUnitCost != null ? landed.source : purchase.source;
  const cogsStatus =
    landedUnitCost != null
      ? OrderItemCogsStatus.captured
      : OrderItemCogsStatus.missing;

  return {
    purchaseCost,
    landedUnitCost,
    costCurrency,
    costSource,
    cogsStatus,
  };
}

export function buildOrderItemCostSnapshot(effective: EffectiveCostLine): {
  unitPurchaseCostSnapshot: number | null;
  unitLandedCostSnapshot: number | null;
  costCurrency: ProductCurrency | null;
  cogsStatus: OrderItemCogsStatus;
  costSource: CostSource | null;
} {
  return {
    unitPurchaseCostSnapshot: effective.purchaseCost,
    unitLandedCostSnapshot: effective.landedUnitCost,
    costCurrency: effective.costCurrency,
    cogsStatus: effective.cogsStatus,
    costSource: effective.costSource,
  };
}
