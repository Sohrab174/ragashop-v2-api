import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { ProductCurrency } from '../../product/entities/product.entity';
import {
  FinancialActorType,
  FinancialEventType,
} from '../finance.types';

@Index('uq_financial_event_idempotencyKey', ['idempotencyKey'], { unique: true })
@Index('idx_financial_event_orderId', ['orderId'], {})
@Index('idx_financial_event_eventType', ['eventType'], {})
@Index('idx_financial_event_occurredAt', ['occurredAt'], {})
@Entity('financial_event')
export class FinancialEventEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'eventType', length: 64 })
  eventType: FinancialEventType | string;

  @Column('decimal', {
    name: 'amount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  amount: number;

  @Column('enum', { name: 'currency', enum: ProductCurrency })
  currency: ProductCurrency;

  @Column('decimal', {
    name: 'amountIrt',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  amountIrt: number | null;

  @Column('decimal', {
    name: 'fxRateToIrt',
    nullable: true,
    precision: 20,
    scale: 6,
    transformer: new DecimalTransformer(),
  })
  fxRateToIrt: number | null;

  @Column('int', { name: 'orderId', nullable: true })
  orderId: number | null;

  @Column('int', { name: 'orderItemId', nullable: true })
  orderItemId: number | null;

  @Column('int', { name: 'transactionId', nullable: true })
  transactionId: number | null;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('int', { name: 'referralAwardId', nullable: true })
  referralAwardId: number | null;

  @Column('varchar', { name: 'sourceType', length: 32 })
  sourceType: string;

  @Column('varchar', { name: 'sourceId', length: 64 })
  sourceId: string;

  @Column('varchar', { name: 'idempotencyKey', length: 128 })
  idempotencyKey: string;

  @Column('int', { name: 'reversalOfEventId', nullable: true })
  reversalOfEventId: number | null;

  @Column('json', { name: 'metadata', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('datetime', { name: 'occurredAt' })
  occurredAt: Date;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('enum', {
    name: 'actorType',
    enum: FinancialActorType,
    default: () => FinancialActorType.system,
  })
  actorType: FinancialActorType;

  @Column('int', { name: 'actorId', nullable: true })
  actorId: number | null;
}
