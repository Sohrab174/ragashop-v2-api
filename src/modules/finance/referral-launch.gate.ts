/**
 * Launch gate for referral awards / invite credits.
 *
 * Fail closed: awards are disabled unless REFERRAL_AWARDS_ENABLED is
 * explicitly "true" or "1". Settings percentages alone are NOT a safe gate
 * because customer-level overrides and signup credits can still award.
 *
 * Historical referral_award / wallet_history / FinancialEvent rows are
 * untouched; this only blocks NEW awards while disabled.
 */
export function isReferralAwardsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.REFERRAL_AWARDS_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}
