import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from 'typeorm/repository/BaseEntity';
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { GatewayEntity } from '../../gateway/entities/gateway.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';

export enum TransactionStatus {
  pending = 'pending',
  verification_started = 'verification_started',
  verification_uncertain = 'verification_uncertain',
  paid = 'paid',
  failed = 'failed',
  superseded = 'superseded',
  provider_paid_superseded = 'provider_paid_superseded',
}

export enum TransactionPaymentSource {
  gateway = 'gateway',
  wallet = 'wallet',
  manual = 'manual',
}

export enum GatewaySessionStatus {
  not_started = 'not_started',
  creating = 'creating',
  ready = 'ready',
  uncertain = 'uncertain',
}

export const GATEWAY_SESSION_LEASE_MS = 120_000;

@Index('fk_transaction_customer1_idx', ['customerId'], {})
@Index('fk_transaction_order1_idx', ['orderId'], {})
@Index('fk_transaction_gateway1_idx', ['gatewayId'], {})
@Entity('transaction')
export class TransactionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'orderId' })
  orderId: number;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('int', { name: 'gatewayId', nullable: true })
  gatewayId: number | null;

  @Column('decimal', {
    name: 'amount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  /**
   * F1: settlement amount in settlementCurrency (IRT/Toman for Iranian rails).
   * Not the commercial TRY Order.finalAmount.
   */
  amount: number;

  @Column('enum', {
    name: 'settlementCurrency',
    enum: ['USD', 'TRY', 'IRT'],
    nullable: true,
  })
  settlementCurrency: 'USD' | 'TRY' | 'IRT' | null;

  @Column('decimal', {
    name: 'fxRateToIrt',
    nullable: true,
    precision: 20,
    scale: 6,
    transformer: new DecimalTransformer(),
  })
  fxRateToIrt: number | null;

  @Column('decimal', {
    name: 'commercialAmount',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  commercialAmount: number | null;

  @Column('enum', {
    name: 'commercialCurrency',
    enum: ['USD', 'TRY', 'IRT'],
    nullable: true,
  })
  commercialCurrency: 'USD' | 'TRY' | 'IRT' | null;

  @Column('decimal', {
    name: 'paymentFeeAmount',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  paymentFeeAmount: number | null;

  @Column('enum', {
    name: 'paymentFeeCurrency',
    enum: ['USD', 'TRY', 'IRT'],
    nullable: true,
  })
  paymentFeeCurrency: 'USD' | 'TRY' | 'IRT' | null;

  @Column('decimal', {
    name: 'walletAmount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletAmount: number;

  @Column('decimal', {
    name: 'walletUSD',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletUSD: number;

  @Column('decimal', {
    name: 'walletIRT',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletIRT: number;

  @Column('decimal', {
    name: 'walletTRY',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletTRY: number;

  @Column('varchar', { name: 'referenceNumber', nullable: true, length: 128 })
  referenceNumber: string | null;

  @Column('varchar', { name: 'randomToken', nullable: true, length: 128 })
  randomToken: string | null;

  @Column('varchar', {
    name: 'gatewayRedirectUrl',
    nullable: true,
    length: 512,
  })
  gatewayRedirectUrl: string | null;

  @Column('enum', {
    name: 'gatewaySessionStatus',
    enum: GatewaySessionStatus,
    default: () => GatewaySessionStatus.not_started,
  })
  gatewaySessionStatus: GatewaySessionStatus;

  @Column('datetime', { name: 'verificationStartedAt', nullable: true })
  verificationStartedAt: Date | null;

  @Column('varchar', {
    name: 'providerVerificationReference',
    nullable: true,
    length: 128,
  })
  providerVerificationReference: string | null;

  @Column('datetime', { name: 'gatewaySessionStartedAt', nullable: true })
  gatewaySessionStartedAt: Date | null;

  @Column('varchar', {
    name: 'gatewaySessionLeaseToken',
    nullable: true,
    length: 64,
  })
  gatewaySessionLeaseToken: string | null;

  @Column('datetime', { name: 'gatewaySessionLeaseExpiresAt', nullable: true })
  gatewaySessionLeaseExpiresAt: Date | null;

  @Column('enum', {
    name: 'paymentSource',
    enum: TransactionPaymentSource,
    nullable: true,
  })
  paymentSource: TransactionPaymentSource | null;

  @Column('int', { name: 'paymentSubmissionId', nullable: true })
  paymentSubmissionId: number | null;

  @Column('varchar', { name: 'manualRail', nullable: true, length: 32 })
  manualRail: string | null;

  @Column('int', { name: 'reconciliationWinningTransactionId', nullable: true })
  reconciliationWinningTransactionId: number | null;

  @Column('varchar', {
    name: 'reconciliationReason',
    nullable: true,
    length: 255,
  })
  reconciliationReason: string | null;

  @Column('datetime', { name: 'reconciliationDetectedAt', nullable: true })
  reconciliationDetectedAt: Date | null;

  @Column('varchar', { name: 'terminalId', nullable: true, length: 45 })
  terminalId: string | null;

  @Column('varchar', { name: 'merchantId', nullable: true, length: 128 })
  merchantId: string | null;

  @Column('varchar', { name: 'payToken', nullable: true, length: 128 })
  payToken: string | null;

  @Column('varchar', { name: 'trackingCode', nullable: true, length: 128 })
  trackingCode: string | null;

  @Column('int', { name: 'verifyStatusNumber', nullable: true })
  verifyStatusNumber: number | null;

  @Column('varchar', { name: 'verifyStatusCode', nullable: true, length: 45 })
  verifyStatusCode: string | null;

  @Column('varchar', { name: 'maskedCardNumber', nullable: true, length: 45 })
  maskedCardNumber: string | null;

  @Column('varchar', { name: 'hashedCardNumber', nullable: true, length: 128 })
  hashedCardNumber: string | null;

  @Column('decimal', {
    name: 'reduceCardAmount',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  reduceCardAmount: number;

  @Column('varchar', { name: 'rnn', nullable: true, length: 128 })
  rnn: string | null;

  @Column('datetime', { name: 'paidAt', nullable: true })
  paidAt: Date | null;

  @Column('varchar', { name: 'message', nullable: true, length: 255 })
  message: string | null;

  @Column('varchar', { name: 'ip', nullable: true, length: 45 })
  ip: string | null;

  @Column('enum', {
    name: 'status',
    enum: TransactionStatus,
    default: () => TransactionStatus.pending,
  })
  status: TransactionStatus;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */

  @ManyToOne(() => CustomerEntity, (customer) => customer.transactions, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity;

  @ManyToOne(() => GatewayEntity, (gateway) => gateway.transactions, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    nullable: true,
  })
  @JoinColumn([{ name: 'gatewayId', referencedColumnName: 'id' }])
  gateway: GatewayEntity | null;

  @ManyToOne(() => OrderEntity, (order) => order.transactions, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'orderId', referencedColumnName: 'id' }])
  order: OrderEntity;
}
