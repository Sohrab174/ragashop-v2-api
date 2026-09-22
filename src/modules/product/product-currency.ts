/**
 * Authoritative commercial/cost currency enum for Product and PAV.
 * Kept outside entity modules to avoid circular TypeORM decorator evaluation.
 */
export enum ProductCurrency {
  USD = 'USD',
  TRY = 'TRY',
  IRT = 'IRT',
}
