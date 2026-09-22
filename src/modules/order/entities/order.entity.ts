import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { TransactionEntity } from '../../transaction/entities/transaction.entity';
import { OrderItemEntity } from './order-item.entity';
import { CityEntity } from '../../city/entities/city.entity';
import { OrderStatusEntity } from './order-status.entity';
import { WalletHistoryEntity } from '../../customer/entities/wallet-history.entity';

export enum OrderStatus {
  pending = 'pending',
  accepted = 'accepted',
  rejected = 'rejected',
  paid = 'paid',
  sent = 'sent',
  delivered = 'delivered',
  buyFromSource = 'buy_from_source',
  sendToDestination = 'send_to_destination',
}

@Index('fk_order_city1_idx', ['cityId'], {})
@Index('fk_order_customer1_idx', ['customerId'], {})
@Index('uq_order_number', ['number'], { unique: true })
@Entity('order')
export class OrderEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'number', length: 45 })
  number: string;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('int', { name: 'successfulTransactionId', nullable: true })
  successfulTransactionId: number | null;

  @ManyToOne(() => TransactionEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'successfulTransactionId', referencedColumnName: 'id' }])
  successfulTransaction: TransactionEntity | null;

  @Column('decimal', {
    name: 'amount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  amount: number;

  @Column('decimal', {
    name: 'discount',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  discount: number | null;

  @Column('decimal', {
    name: 'shipping',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  shipping: number;

  @Column('decimal', {
    name: 'tax',
    nullable: true,
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  tax: number | null;

  @Column('decimal', {
    name: 'finalAmount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  finalAmount: number;

  /**
   * Currency of amount/discount/shipping/tax/finalAmount (F1).
   * Modern checkout writes TRY. IRT means Iranian Toman.
   */
  @Column('enum', {
    name: 'commercialCurrency',
    enum: ['USD', 'TRY', 'IRT'],
    nullable: true,
  })
  commercialCurrency: 'USD' | 'TRY' | 'IRT' | null;

  /** Effective Toman per 1 commercial currency unit at Order create (F1). */
  @Column('decimal', {
    name: 'fxRateToIrt',
    nullable: true,
    precision: 20,
    scale: 6,
    transformer: new DecimalTransformer(),
  })
  fxRateToIrt: number | null;

  @Column('datetime', { name: 'fxCapturedAt', nullable: true })
  fxCapturedAt: Date | null;

  @Column('varchar', { name: 'fxRateSource', nullable: true, length: 32 })
  fxRateSource: string | null;

  @Column('datetime', { name: 'financialConfirmedAt', nullable: true })
  financialConfirmedAt: Date | null;

  @Column('enum', {
    name: 'profitabilityStatus',
    enum: ['complete', 'incomplete_missing_cogs', 'legacy_incomplete'],
    nullable: true,
  })
  profitabilityStatus:
    | 'complete'
    | 'incomplete_missing_cogs'
    | 'legacy_incomplete'
    | null;

  /** Latest known carrier cost (ops); trail via financial events later. */
  @Column('decimal', {
    name: 'shippingCostActual',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  shippingCostActual: number | null;

  @Column('varchar', { name: 'firstName', nullable: true, length: 45 })
  firstName: string | null;

  @Column('varchar', { name: 'lastName', nullable: true, length: 45 })
  lastName: string | null;

  @Column('text', { name: 'address', nullable: true })
  address: string | null;

  @Column('varchar', { name: 'location', nullable: true, length: 45 })
  location: string | null;

  @Column('varchar', { name: 'addressDetails', nullable: true, length: 255 })
  addressDetails: string | null;

  @Column('varchar', { name: 'postalCode', nullable: true, length: 45 })
  postalCode: string | null;

  @Column('varchar', { name: 'phone', nullable: true, length: 45 })
  phone: string | null;

  @Column('int', { name: 'cityId', nullable: true })
  cityId: number | null;

  /** Opaque secret for guest order confirmation reads (not sequential). */
  @Column('varchar', { name: 'guestAccessToken', nullable: true, length: 64 })
  guestAccessToken: string | null;

  /** Owner-scoped checkout idempotency digest (SHA-256 hex); unique when set. */
  @Column('varchar', {
    name: 'checkoutIdempotencyKey',
    nullable: true,
    length: 64,
  })
  checkoutIdempotencyKey: string | null;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('varchar', { name: 'postTrackingCode', nullable: true, length: 128 })
  postTrackingCode: string | null;

  @Column('varchar', {
    name: 'sourceTrackingCode',
    nullable: true,
    length: 128,
  })
  sourceTrackingCode: string | null;

  @Column('enum', {
    name: 'status',
    enum: OrderStatus,
    default: () => OrderStatus.pending,
  })
  status: OrderStatus;

  @Column('varchar', { name: 'reasonRejected', nullable: true, length: 255 })
  reasonRejected: string | null;

  @Column('tinyint', { name: 'isDeleted', width: 1, default: () => "'0'" })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => CustomerEntity, (customer) => customer.orders, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity;

  @OneToMany(() => OrderItemEntity, (orderItem) => orderItem.order)
  orderItems: OrderItemEntity[];

  @OneToMany(() => TransactionEntity, (transaction) => transaction.order)
  transactions: TransactionEntity[];

  @ManyToOne(() => CityEntity, (city) => city.orders, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'cityId', referencedColumnName: 'id' }])
  city: CityEntity;

  @OneToMany(() => OrderStatusEntity, (orderStatus) => orderStatus.order)
  orderStatuses: OrderStatusEntity[];

  @OneToMany(
    () => WalletHistoryEntity,
    (walletHistory) => walletHistory.relatedOrder,
  )
  walletHistories: WalletHistoryEntity[];
}
