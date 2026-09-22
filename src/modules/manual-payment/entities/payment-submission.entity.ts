import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import {
  ManualPaymentRail,
  PaymentSubmissionPurpose,
  PaymentSubmissionStatus,
} from '../manual-payment.types';

@Index('uq_payment_submission_customer_order_idempotency', [
  'customerId',
  'orderId',
  'idempotencyKey',
], {
  unique: true,
})
@Index('uq_payment_submission_activeLockKey', ['activeLockKey'], {
  unique: true,
})
@Entity('payment_submission')
export class PaymentSubmissionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('enum', {
    name: 'purpose',
    enum: PaymentSubmissionPurpose,
    default: () => PaymentSubmissionPurpose.ORDER_PAYMENT,
  })
  purpose: PaymentSubmissionPurpose;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('int', { name: 'orderId' })
  orderId: number;

  @Column('enum', { name: 'rail', enum: ManualPaymentRail })
  rail: ManualPaymentRail;

  @Column('int', { name: 'bankDestinationId', nullable: true })
  bankDestinationId: number | null;

  @Column('varchar', {
    name: 'destinationBankName',
    nullable: true,
    length: 128,
  })
  destinationBankName: string | null;

  @Column('varchar', {
    name: 'destinationAccountHolderName',
    nullable: true,
    length: 255,
  })
  destinationAccountHolderName: string | null;

  @Column('varchar', {
    name: 'destinationCardNumber',
    nullable: true,
    length: 32,
  })
  destinationCardNumber: string | null;

  @Column('varchar', { name: 'destinationIban', nullable: true, length: 34 })
  destinationIban: string | null;

  @Column('varchar', {
    name: 'destinationAccountNumber',
    nullable: true,
    length: 64,
  })
  destinationAccountNumber: string | null;

  @Column('decimal', {
    name: 'expectedAmount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  expectedAmount: number;

  @Column('enum', {
    name: 'expectedCurrency',
    enum: ['USD', 'TRY', 'IRT'],
    default: () => "'IRT'",
  })
  expectedCurrency: 'USD' | 'TRY' | 'IRT';

  @Column('enum', {
    name: 'status',
    enum: PaymentSubmissionStatus,
    default: () => PaymentSubmissionStatus.SUBMITTED,
  })
  status: PaymentSubmissionStatus;

  @Column('int', { name: 'activeEvidenceId', nullable: true })
  activeEvidenceId: number | null;

  @Column('datetime', { name: 'holdExpiresAt', nullable: true })
  holdExpiresAt: Date | null;

  @Column('datetime', { name: 'reviewedAt', nullable: true })
  reviewedAt: Date | null;

  @Column('int', { name: 'reviewedByUserId', nullable: true })
  reviewedByUserId: number | null;

  @Column('varchar', {
    name: 'rejectionReasonCode',
    nullable: true,
    length: 64,
  })
  rejectionReasonCode: string | null;

  @Column('varchar', {
    name: 'rejectionReasonText',
    nullable: true,
    length: 512,
  })
  rejectionReasonText: string | null;

  @Column('datetime', { name: 'claimedAt', nullable: true })
  claimedAt: Date | null;

  @Column('int', { name: 'claimedByUserId', nullable: true })
  claimedByUserId: number | null;

  @Column('varchar', {
    name: 'amountMismatchOverrideReason',
    nullable: true,
    length: 512,
  })
  amountMismatchOverrideReason: string | null;

  @Column('int', { name: 'transactionId', nullable: true })
  transactionId: number | null;

  @Column('varchar', { name: 'idempotencyKey', length: 128 })
  idempotencyKey: string;

  /** Set only while SUBMITTED/UNDER_REVIEW to enforce one active hold per order. */
  @Column('varchar', { name: 'activeLockKey', nullable: true, length: 64 })
  activeLockKey: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}
