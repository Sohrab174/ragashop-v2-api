/**
 * @ragashop/marketplace-identity-lease
 * Single authoritative identity-lease / soft-window contract for API + crawler.
 */

'use strict';

class MarketplaceIdentityLeaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarketplaceIdentityLeaseConfigError';
  }
}

const MARKETPLACE_IDENTITY_LEASE_DEFAULT_MS = 600000;
const MARKETPLACE_IDENTITY_LEASE_MIN_MS = 60000;
const MARKETPLACE_IDENTITY_LEASE_MAX_MS = 3600000;
const DEFAULT_CRAWLER_BASE_URL = 'http://127.0.0.1:9020';

function parseMarketplaceIdentityLeaseMs(
  raw,
  fallback = MARKETPLACE_IDENTITY_LEASE_DEFAULT_MS,
) {
  const value =
    raw == null || raw === ''
      ? fallback
      : typeof raw === 'number'
      ? raw
      : Number(raw);

  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MARKETPLACE_IDENTITY_LEASE_MIN_MS ||
    value > MARKETPLACE_IDENTITY_LEASE_MAX_MS
  ) {
    throw new MarketplaceIdentityLeaseConfigError(
      `MARKETPLACE_IDENTITY_LEASE_MS must be an integer between ${MARKETPLACE_IDENTITY_LEASE_MIN_MS} and ${MARKETPLACE_IDENTITY_LEASE_MAX_MS}`,
    );
  }

  return value;
}

function loadMarketplaceIdentityLeaseMsFromEnv(env = process.env) {
  return parseMarketplaceIdentityLeaseMs(env.MARKETPLACE_IDENTITY_LEASE_MS);
}

function resolveImportInProgressSoftWindowMs(options) {
  const leaseMs = options.crawlerIdentityLeaseMs;
  const raw = options.softWindowRaw;
  if (raw == null || raw === '') {
    return leaseMs;
  }
  const softMs = parseMarketplaceIdentityLeaseMs(raw, leaseMs);
  if (softMs < leaseMs) {
    throw new MarketplaceIdentityLeaseConfigError(
      `MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS (${softMs}) must be >= crawler identity lease (${leaseMs})`,
    );
  }
  return softMs;
}

/**
 * Same default the API ConfigurationService / crawler client use.
 */
function getEffectiveCrawlerBaseUrl(env = process.env) {
  const raw = (env.CRAWLER_BASE_URL || '').trim();
  return raw || DEFAULT_CRAWLER_BASE_URL;
}

/**
 * Skip remote lease check ONLY when NODE_ENV === "test".
 * No secondary env var may make production/development "test-like".
 */
function assertCrawlerLeaseSkipAllowed(env = process.env) {
  const skip =
    env.MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK === 'true' ||
    env.MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK === '1';
  if (!skip) {
    return false;
  }
  if (env.NODE_ENV !== 'test') {
    throw new MarketplaceIdentityLeaseConfigError(
      'MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK is allowed only when NODE_ENV=test',
    );
  }
  return true;
}

module.exports = {
  MarketplaceIdentityLeaseConfigError,
  MARKETPLACE_IDENTITY_LEASE_DEFAULT_MS,
  MARKETPLACE_IDENTITY_LEASE_MIN_MS,
  MARKETPLACE_IDENTITY_LEASE_MAX_MS,
  DEFAULT_CRAWLER_BASE_URL,
  parseMarketplaceIdentityLeaseMs,
  loadMarketplaceIdentityLeaseMsFromEnv,
  resolveImportInProgressSoftWindowMs,
  getEffectiveCrawlerBaseUrl,
  assertCrawlerLeaseSkipAllowed,
};
