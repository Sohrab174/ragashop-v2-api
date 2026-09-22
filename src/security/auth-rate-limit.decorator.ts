import { SetMetadata } from '@nestjs/common';
import { AuthRateLimitKind } from './auth-rate-limit.service';

export const AUTH_RATE_LIMIT_KEY = 'authRateLimit';

export type AuthRateLimitMeta = {
  kind: AuthRateLimitKind;
  /**
   * Body fields inspected (first non-empty wins) for identity dimension.
   * Always rate-limited even when missing (uses "anonymous").
   */
  identityFields?: string[];
};

export const AuthRateLimit = (meta: AuthRateLimitMeta) =>
  SetMetadata(AUTH_RATE_LIMIT_KEY, meta);
