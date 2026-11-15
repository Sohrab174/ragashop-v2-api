import {
  DISCOUNT_ENGINE_DEFAULT_LISTING_BUDGET,
  DISCOUNT_ENGINE_DEFAULT_PDP_BUDGET,
  DISCOUNT_ENGINE_DEFAULT_POOL_MAX,
  DISCOUNT_ENGINE_DEFAULT_POOL_MIN,
  DISCOUNT_ENGINE_LISTING_BUDGET_ENV,
  DISCOUNT_ENGINE_LIVE_ENABLED_ENV,
  DISCOUNT_ENGINE_LIVE_LISTING_ENV,
  DISCOUNT_ENGINE_PDP_BUDGET_ENV,
  DISCOUNT_ENGINE_POOL_TARGET_MAX_ENV,
  DISCOUNT_ENGINE_POOL_TARGET_MIN_ENV,
} from './discount-engine.constants';

function parseBool(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min = 1,
  max = 500,
): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export type DiscountEngineRuntimeConfig = {
  livePdpEnabled: boolean;
  liveListingEnabled: boolean;
  listingBudget: number;
  pdpBudget: number;
  poolTargetMin: number;
  poolTargetMax: number;
};

export function loadDiscountEngineConfig(
  env: NodeJS.ProcessEnv = process.env,
): DiscountEngineRuntimeConfig {
  const poolTargetMin = parsePositiveInt(
    env[DISCOUNT_ENGINE_POOL_TARGET_MIN_ENV],
    DISCOUNT_ENGINE_DEFAULT_POOL_MIN,
    1,
    200,
  );
  let poolTargetMax = parsePositiveInt(
    env[DISCOUNT_ENGINE_POOL_TARGET_MAX_ENV],
    DISCOUNT_ENGINE_DEFAULT_POOL_MAX,
    1,
    200,
  );
  if (poolTargetMax < poolTargetMin) poolTargetMax = poolTargetMin;

  return {
    livePdpEnabled: parseBool(env[DISCOUNT_ENGINE_LIVE_ENABLED_ENV], false),
    liveListingEnabled: parseBool(env[DISCOUNT_ENGINE_LIVE_LISTING_ENV], false),
    listingBudget: parsePositiveInt(
      env[DISCOUNT_ENGINE_LISTING_BUDGET_ENV],
      DISCOUNT_ENGINE_DEFAULT_LISTING_BUDGET,
      1,
      100,
    ),
    pdpBudget: parsePositiveInt(
      env[DISCOUNT_ENGINE_PDP_BUDGET_ENV],
      DISCOUNT_ENGINE_DEFAULT_PDP_BUDGET,
      1,
      200,
    ),
    poolTargetMin,
    poolTargetMax,
  };
}

export function isDiscountEngineLiveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBool(env[DISCOUNT_ENGINE_LIVE_ENABLED_ENV], false);
}
