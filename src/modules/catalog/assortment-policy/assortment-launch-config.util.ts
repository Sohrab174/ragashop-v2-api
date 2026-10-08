/**
 * Staging / pre-staging fail-closed validation for launch-critical
 * assortment + catalog-mapping flags.
 *
 * Development and Jest remain opt-in (unset ⇒ enforcement off).
 * Only DEPLOY_ENV=staging|pre-staging requires exact literal '1'.
 */

import {
  ASSORTMENT_COMMERCE_ENFORCEMENT_ENV,
  ASSORTMENT_CRAWLER_ENFORCEMENT_ENV,
  ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV,
} from './assortment-enforcement';
import { CATALOG_MAPPING_V2_ENV } from '../canonical-product-eligibility';

export const DEPLOY_ENV_KEY = 'DEPLOY_ENV';

export class AssortmentLaunchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssortmentLaunchConfigError';
  }
}

export function isStagingLaunchEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env[DEPLOY_ENV_KEY] || '')
    .trim()
    .toLowerCase();
  return raw === 'staging' || raw === 'pre-staging';
}

function requireExactOne(
  env: NodeJS.ProcessEnv,
  name: string,
  failures: string[],
): void {
  if (env[name] !== '1') {
    failures.push(`${name} must be exactly '1'`);
  }
}

/**
 * Pure validator. Skips when NODE_ENV=test or when not staging/pre-staging.
 * Does not read or echo secret values.
 */
export function validateAssortmentLaunchRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'test') {
    return;
  }
  if (!isStagingLaunchEnv(env)) {
    return;
  }

  const failures: string[] = [];
  requireExactOne(env, ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV, failures);
  requireExactOne(env, ASSORTMENT_COMMERCE_ENFORCEMENT_ENV, failures);
  requireExactOne(env, ASSORTMENT_CRAWLER_ENFORCEMENT_ENV, failures);
  requireExactOne(env, CATALOG_MAPPING_V2_ENV, failures);

  if (failures.length > 0) {
    throw new AssortmentLaunchConfigError(
      `Staging assortment configuration invalid: ${failures.join('; ')}. ` +
        `Set each flag to the literal value 1 (not true/yes/on).`,
    );
  }
}
