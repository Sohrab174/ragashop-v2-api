import { FX_RATE_SOURCE_TGJU } from '../finance/finance.types';

/** Opt-in only. Must be the string "true" to allow bootstrap. Default: disabled. */
export const SETTINGS_BOOTSTRAP_ENABLED_ENV = 'SETTINGS_BOOTSTRAP_ENABLED';

/** Cooperative MySQL named lock (same pattern as FX refresh). */
export const SETTINGS_BOOTSTRAP_LOCK_NAME = 'ragashop_setting_bootstrap';

export type SettingsBootstrapOutcome =
  | 'created'
  | 'skipped_disabled'
  | 'skipped_existing'
  | 'failed';

export type SettingsBootstrapResult = {
  outcome: SettingsBootstrapOutcome;
  /** True only after approved singleton exists AND a genuine fresh TGJU rate is persisted. */
  storefrontReady: boolean;
  settingId: number | null;
  tryToRial: number | null;
  message: string;
  /** True when the INSERT transaction committed successfully. */
  settingsCommitted: boolean;
  /**
   * True when settings exist/committed but FX must be recovered separately
   * (retrying bootstrap will skip_existing).
   */
  fxRecoveryRequired: boolean;
};

/**
 * Owner-approved INITIAL Production singleton.
 * Editable later via Admin/API (DTO); not a permanent runtime override.
 */
export const APPROVED_SETTINGS_BOOTSTRAP_SINGLETON = {
  id: 1 as const,
  phone: null as string | null,
  email: null as string | null,
  address: null as string | null,
  location: null as string | null,
  instagram: null as string | null,
  linkedin: null as string | null,
  telegram: null as string | null,
  twitter: null as string | null,
  facebook: null as string | null,
  whatsapp: null as string | null,
  maxShippingCost: 0.0,
  shippingPercent: 0.0,
  taxPercent: 0.0,
  invitedByReferrerCreditUSD: 0.0,
  invitedByReferrerCreditIRT: 0.0,
  invitedByReferrerCreditTRY: 0.0,
  buyPercentToReferrerCreditUSD: 0.0,
  buyPercentToReferrerCreditIRT: 0.0,
  buyPercentToReferrerCreditTRY: 0.0,
  noticeBeforeOrdering: null as string | null,
  minDeliveryDay: 10,
  maxDeliveryDay: 15,
  tryToRial: 0.0,
  changePercentTryToRial: 30.0,
  tryToRialFetchedAt: null as Date | null,
  tryToRialSource: FX_RATE_SOURCE_TGJU,
  manualPaymentSubmitDeadlineHours: 24,
  manualPaymentReviewHoldHours: 48,
  manualPaymentResubmitGraceHours: 24,
  onlineGatewayPaymentsEnabled: false,
  walletSpendEnabled: false,
};

export function isSettingsBootstrapEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[SETTINGS_BOOTSTRAP_ENABLED_ENV] === 'true';
}
