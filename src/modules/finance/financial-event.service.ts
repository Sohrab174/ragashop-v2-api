import { Injectable } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { isMysqlDuplicateKeyError } from '../order/utils/duplicate-key.util';
import { ProductCurrency } from '../product/entities/product.entity';
import { FinancialEventEntity } from './entities/financial-event.entity';
import {
  FinancialActorType,
  FinancialEventType,
} from './finance.types';

export type InsertFinancialEventInput = {
  eventType: FinancialEventType | string;
  amount: number;
  currency: ProductCurrency;
  amountIrt?: number | null;
  fxRateToIrt?: number | null;
  orderId?: number | null;
  orderItemId?: number | null;
  transactionId?: number | null;
  customerId?: number | null;
  referralAwardId?: number | null;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  reversalOfEventId?: number | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
  actorType?: FinancialActorType;
  actorId?: number | null;
};

/**
 * Append-only financial event writer. No monetary updates — insert or no-op.
 */
@Injectable()
export class FinancialEventService {
  /**
   * Insert once by idempotencyKey. Returns 'inserted' | 'duplicate'.
   */
  async insertIdempotent(
    queryRunner: QueryRunner,
    input: InsertFinancialEventInput,
  ): Promise<'inserted' | 'duplicate'> {
    const now = new Date();
    try {
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(FinancialEventEntity)
        .values({
          eventType: input.eventType as any,
          amount: input.amount,
          currency: input.currency,
          amountIrt: input.amountIrt ?? null,
          fxRateToIrt: input.fxRateToIrt ?? null,
          orderId: input.orderId ?? null,
          orderItemId: input.orderItemId ?? null,
          transactionId: input.transactionId ?? null,
          customerId: input.customerId ?? null,
          referralAwardId: input.referralAwardId ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
          reversalOfEventId: input.reversalOfEventId ?? null,
          metadata: input.metadata ?? null,
          occurredAt: input.occurredAt ?? now,
          createdAt: now,
          actorType: input.actorType ?? FinancialActorType.system,
          actorId: input.actorId ?? null,
        } as any)
        .execute();
      return 'inserted';
    } catch (err) {
      if (isMysqlDuplicateKeyError(err)) {
        return 'duplicate';
      }
      throw err;
    }
  }
}
