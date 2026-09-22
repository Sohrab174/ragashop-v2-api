import { Injectable } from '@nestjs/common';
import { Connection } from 'typeorm';
import { createHash } from 'crypto';
import { withMysqlNamedLock } from '../../utils/named-lock.util';

@Injectable()
export class FavoriteLockService {
  constructor(private readonly connection: Connection) {}

  private lockName(customerId: number, productId: number): string {
    const digest = createHash('sha256')
      .update(`${customerId}:${productId}`)
      .digest('hex')
      .slice(0, 32);
    return `ragashop_favorite_${digest}`;
  }

  async withFavoriteToggleLock<T>(
    customerId: number,
    productId: number,
    fn: () => Promise<T>,
    timeoutSeconds = 10,
  ): Promise<T> {
    return withMysqlNamedLock(
      this.connection,
      this.lockName(customerId, productId),
      fn,
      timeoutSeconds,
    );
  }
}
