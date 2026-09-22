import { Application } from 'express';
import {
  MarketplaceConfigError,
  parsePositiveIntConfig,
} from './marketplace-config.util';

export type TrustProxySetting =
  | { mode: 'off' }
  | { mode: 'hops'; hops: number };

const TRUST_PROXY_HOPS_MIN = 1;
const TRUST_PROXY_HOPS_MAX = 10;

export function parseTrustProxyHops(raw: string | number | undefined): number {
  return parsePositiveIntConfig(
    raw,
    1,
    TRUST_PROXY_HOPS_MIN,
    TRUST_PROXY_HOPS_MAX,
    'TRUST_PROXY_HOPS',
  );
}

export function parseTrustProxySetting(
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  const explicitMode = (env.TRUST_PROXY_MODE || '').trim().toLowerCase();
  const legacyTrust = (env.TRUST_PROXY || '').trim().toLowerCase();

  if (explicitMode === 'off') {
    return { mode: 'off' };
  }

  if (explicitMode === 'hops') {
    return { mode: 'hops', hops: parseTrustProxyHops(env.TRUST_PROXY_HOPS) };
  }

  if (explicitMode) {
    throw new MarketplaceConfigError(
      "TRUST_PROXY_MODE must be 'off' or 'hops'",
    );
  }

  if (legacyTrust === 'true') {
    return { mode: 'hops', hops: parseTrustProxyHops(env.TRUST_PROXY_HOPS) };
  }

  if (legacyTrust === 'false' || legacyTrust === '') {
    return { mode: 'off' };
  }

  throw new MarketplaceConfigError(
    "TRUST_PROXY must be 'true' or 'false' when TRUST_PROXY_MODE is unset",
  );
}

export function configureExpressTrustProxy(
  app: Application,
  setting: TrustProxySetting,
): void {
  if (setting.mode === 'off') {
    app.set('trust proxy', false);
    return;
  }

  app.set('trust proxy', setting.hops);
}

export function validateTrustProxyRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  return parseTrustProxySetting(env);
}
