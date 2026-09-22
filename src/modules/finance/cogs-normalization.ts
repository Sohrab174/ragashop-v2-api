import { ProductCurrency } from '../product/entities/product.entity';
import { OrderItemCogsStatus } from './finance.types';

export type CogsLineInput = {
  quantity: number;
  unitLandedCostSnapshot: number | null | undefined;
  costCurrency: ProductCurrency | string | null | undefined;
  cogsStatus: OrderItemCogsStatus | string | null | undefined;
};

export type CogsNormalizeFailureReason =
  | 'empty'
  | 'missing_landed'
  | 'missing_currency'
  | 'unsupported_currency'
  | 'missing_order_fx';

export type CogsNormalizeResult =
  | {
      ok: true;
      totalIrt: number;
      fxRateToIrt: number | null;
      lineCount: number;
    }
  | {
      ok: false;
      reason: CogsNormalizeFailureReason;
    };

function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Normalize OrderItem landed-cost snapshots to IRT using only Order FX evidence.
 *
 * - IRT: already IRT
 * - TRY: Order.fxRateToIrt only (never live TGJU)
 * - USD / other / missing currency: incomplete — do not invent conversion
 */
export function normalizeOrderCogsToIrt(
  items: CogsLineInput[],
  orderFxRateToIrt: number | null | undefined,
): CogsNormalizeResult {
  if (!items.length) {
    return { ok: false, reason: 'empty' };
  }

  const fx = Number(orderFxRateToIrt);
  const hasValidOrderFx = Number.isFinite(fx) && fx > 0;
  let totalIrt = 0;
  let usedTryFx = false;

  for (const item of items) {
    if (
      item.cogsStatus !== OrderItemCogsStatus.captured ||
      item.unitLandedCostSnapshot == null
    ) {
      return { ok: false, reason: 'missing_landed' };
    }

    const unit = Number(item.unitLandedCostSnapshot);
    const qty = Number(item.quantity);
    if (!Number.isFinite(unit) || !Number.isFinite(qty) || qty < 0) {
      return { ok: false, reason: 'missing_landed' };
    }

    const line = unit * qty;
    const currency = item.costCurrency;

    if (currency == null) {
      return { ok: false, reason: 'missing_currency' };
    }

    if (currency === ProductCurrency.IRT) {
      totalIrt += line;
      continue;
    }

    if (currency === ProductCurrency.TRY) {
      if (!hasValidOrderFx) {
        return { ok: false, reason: 'missing_order_fx' };
      }
      totalIrt += line * fx;
      usedTryFx = true;
      continue;
    }

    // USD (and any other) has no FIN-1 Order conversion snapshot.
    return { ok: false, reason: 'unsupported_currency' };
  }

  return {
    ok: true,
    totalIrt: roundMoney2(totalIrt),
    fxRateToIrt: usedTryFx ? fx : hasValidOrderFx ? fx : null,
    lineCount: items.length,
  };
}
