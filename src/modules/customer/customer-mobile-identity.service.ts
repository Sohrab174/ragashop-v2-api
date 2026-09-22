import { Injectable } from '@nestjs/common';
import { Connection } from 'typeorm';
import { createHash } from 'crypto';
import { normalizeCustomerMobile } from '../../utils/mobile-normalization';
import { withMysqlNamedLock } from '../../utils/named-lock.util';

@Injectable()
export class CustomerMobileIdentityService {
  constructor(private readonly connection: Connection) {}

  normalizeMobile(mobile: string): string {
    return normalizeCustomerMobile(mobile);
  }

  private lockName(normalizedMobile: string): string {
    const digest = createHash('sha256')
      .update(normalizedMobile)
      .digest('hex')
      .slice(0, 32);
    return `ragashop_customer_mobile_${digest}`;
  }

  /**
   * Serializes first-login / creation for the same normalized mobile.
   * Uses MySQL named locks — no schema change required for Phase 2B-3.
   * Do not perform slow external work (SMS, email) inside fn().
   */
  async withNormalizedMobileLock<T>(
    mobile: string,
    fn: () => Promise<T>,
    timeoutSeconds = 10,
  ): Promise<T> {
    const normalized = this.normalizeMobile(mobile);
    return withMysqlNamedLock(
      this.connection,
      this.lockName(normalized),
      fn,
      timeoutSeconds,
    );
  }
}
