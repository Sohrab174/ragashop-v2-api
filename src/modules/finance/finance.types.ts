/**
 * Phase F1 money / cost / event vocabulary.
 * IRT = Iranian TOMAN (not Rial).
 */

export enum CostSource {
  manual_admin = 'manual_admin',
  import_manual = 'import_manual',
  calculated = 'calculated',
  unknown_legacy = 'unknown_legacy',
}

export enum OrderItemCogsStatus {
  captured = 'captured',
  missing = 'missing',
  legacy_unknown = 'legacy_unknown',
}

export enum ProfitabilityStatus {
  complete = 'complete',
  incomplete_missing_cogs = 'incomplete_missing_cogs',
  legacy_incomplete = 'legacy_incomplete',
}

export enum FinancialEventType {
  ORDER_COGS_RECOGNIZED = 'ORDER_COGS_RECOGNIZED',
  REFERRAL_COMMISSION_EARNED = 'REFERRAL_COMMISSION_EARNED',
  // Reserved for future phases (schema/docs only in F1 emitters):
  COGS_ADJUSTMENT = 'COGS_ADJUSTMENT',
  SHIPPING_COST = 'SHIPPING_COST',
  SHIPPING_COST_ADJUSTMENT = 'SHIPPING_COST_ADJUSTMENT',
  PAYMENT_FEE = 'PAYMENT_FEE',
  PAYMENT_FEE_ADJUSTMENT = 'PAYMENT_FEE_ADJUSTMENT',
  WALLET_CASH_FUNDED = 'WALLET_CASH_FUNDED',
  WALLET_CASH_SPENT = 'WALLET_CASH_SPENT',
  PROMO_CREDIT_GRANTED = 'PROMO_CREDIT_GRANTED',
  PROMO_CREDIT_SPENT = 'PROMO_CREDIT_SPENT',
  REFERRAL_COMMISSION_REVERSED = 'REFERRAL_COMMISSION_REVERSED',
  REFUND = 'REFUND',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum FinancialActorType {
  system = 'system',
  admin_user = 'admin_user',
  customer = 'customer',
  employee = 'employee',
}

export const FX_RATE_SOURCE_TGJU = 'TGJU';

/** Default max age for live rate used to price NEW orders (15 minutes). */
export const DEFAULT_FX_RATE_MAX_AGE_MS = 15 * 60 * 1000;
