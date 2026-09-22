import { ProductCurrency } from '../product/entities/product.entity';

/**
 * Single payment conversion boundary.
 *
 * commercialAmount (typically TRY) × order.fxRateToIrt → settlement IRT (Toman).
 * Transaction.amount MUST be settlement amount in settlementCurrency after F1.
 */
export type OrderSettlementInput = {
  finalAmount: number;
  commercialCurrency: ProductCurrency | 'USD' | 'TRY' | 'IRT' | null | undefined;
  fxRateToIrt: number | null | undefined;
};

export type SettlementMoney = {
  commercialAmount: number;
  commercialCurrency: ProductCurrency;
  settlementCurrency: ProductCurrency.IRT;
  settlementAmount: number;
  fxRateToIrt: number;
};

export function roundSettlementIrt(value: number): number {
  return Math.round(Number(value));
}

/**
 * Convert Order commercial payable to IRT/Toman settlement using Order FX snapshot.
 * Throws if snapshot rate is missing/invalid (caller may handle legacy separately).
 */
export function computeSettlementFromOrderSnapshot(
  order: OrderSettlementInput,
): SettlementMoney {
  const commercialAmount = Number(order.finalAmount);
  const fxRateToIrt = Number(order.fxRateToIrt);
  const commercialCurrency = (order.commercialCurrency ??
    ProductCurrency.TRY) as ProductCurrency;

  if (!Number.isFinite(commercialAmount) || commercialAmount < 0) {
    throw new Error('invalid_commercial_amount');
  }
  if (!Number.isFinite(fxRateToIrt) || fxRateToIrt <= 0) {
    throw new Error('order_fx_snapshot_missing');
  }

  if (commercialCurrency === ProductCurrency.IRT) {
    return {
      commercialAmount,
      commercialCurrency,
      settlementCurrency: ProductCurrency.IRT,
      settlementAmount: roundSettlementIrt(commercialAmount),
      fxRateToIrt: 1,
    };
  }

  return {
    commercialAmount,
    commercialCurrency,
    settlementCurrency: ProductCurrency.IRT,
    settlementAmount: roundSettlementIrt(commercialAmount * fxRateToIrt),
    fxRateToIrt,
  };
}

/**
 * Gateway (PayPing) charge in IRT = settlement − wallet cover.
 * Transaction.amount is always full settlement; never send full amount to gateway
 * when wallet contributed.
 */
export function getGatewayChargeIrt(transaction: {
  amount: number;
  walletAmount?: number | null;
}): number {
  const settlement = Number(transaction.amount);
  const wallet = Number(transaction.walletAmount) || 0;
  if (!Number.isFinite(settlement) || settlement < 0) {
    throw new Error('invalid_settlement_amount');
  }
  const charge = roundSettlementIrt(settlement - wallet);
  if (charge < 0) {
    throw new Error('invalid_gateway_charge');
  }
  return charge;
}

export const LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING =
  'legacy_transaction_settlement_metadata_missing';

export type Fin1SettlementEvidenceTransaction = {
  amount: number | null | undefined;
  settlementCurrency?: ProductCurrency | string | null;
  commercialAmount?: number | null;
  commercialCurrency?: ProductCurrency | string | null;
  fxRateToIrt?: number | null;
};

export type Fin1SettlementEvidenceOrder = {
  commercialCurrency?: ProductCurrency | string | null;
  fxRateToIrt?: number | null;
} | null;

function isPositiveFinite(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

/**
 * FIN-1: legacy pending rows must not resume/verify as modern settlement.
 * Does not fetch TGJU, invent FX, or reinterpret historical Transaction.amount.
 */
export function assertFin1SettlementEvidence(
  transaction: Fin1SettlementEvidenceTransaction,
  order?: Fin1SettlementEvidenceOrder,
): void {
  const settlementCurrency = transaction.settlementCurrency ?? null;
  const commercialCurrency = transaction.commercialCurrency ?? null;
  const commercialAmount = transaction.commercialAmount;
  const txFx = transaction.fxRateToIrt;

  if (
    settlementCurrency !== ProductCurrency.IRT ||
    commercialCurrency == null ||
    commercialCurrency === '' ||
    !isNonNegativeFinite(commercialAmount) ||
    !isNonNegativeFinite(transaction.amount)
  ) {
    throw new Error(LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING);
  }

  if (commercialCurrency === ProductCurrency.TRY) {
    if (!isPositiveFinite(txFx)) {
      throw new Error(LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING);
    }
  } else if (commercialCurrency === ProductCurrency.IRT) {
    // IRT commercial does not require a TRY FX on the transaction.
  } else if (commercialCurrency === ProductCurrency.USD) {
    throw new Error(LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING);
  } else {
    throw new Error(LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING);
  }

  if (order) {
    const orderCommercial = order.commercialCurrency ?? null;
    if (orderCommercial == null || orderCommercial === '') {
      throw new Error('order_fx_snapshot_missing');
    }
    if (orderCommercial === ProductCurrency.TRY) {
      if (!isPositiveFinite(order.fxRateToIrt)) {
        throw new Error('order_fx_snapshot_missing');
      }
    }
  }
}
