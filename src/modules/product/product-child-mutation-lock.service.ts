import { Injectable } from '@nestjs/common';
import { Connection } from 'typeorm';
import { withMysqlNamedLock } from '../../utils/named-lock.util';
import { productChildMutationLockName } from './product-child-mutation-lock.util';

@Injectable()
export class ProductChildMutationLockService {
  constructor(private readonly connection: Connection) {}

  async withProductChildLock<T>(
    productId: number,
    fn: () => Promise<T>,
    timeoutSeconds = 15,
  ): Promise<T> {
    return withMysqlNamedLock(
      this.connection,
      productChildMutationLockName(productId),
      fn,
      timeoutSeconds,
    );
  }
}
