import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';

@Index('uq_payment_evidence_submission_attempt', ['submissionId', 'attemptNo'], {
  unique: true,
})
@Entity('payment_evidence')
export class PaymentEvidenceEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'submissionId' })
  submissionId: number;

  @Column('int', { name: 'attemptNo' })
  attemptNo: number;

  @Column('int', { name: 'receiptObjectId' })
  receiptObjectId: number;

  @Column('decimal', {
    name: 'submittedAmount',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  submittedAmount: number | null;

  @Column('enum', {
    name: 'submittedCurrency',
    enum: ['USD', 'TRY', 'IRT'],
    default: () => "'IRT'",
  })
  submittedCurrency: 'USD' | 'TRY' | 'IRT';

  @Column('varchar', { name: 'bankReference', nullable: true, length: 128 })
  bankReference: string | null;

  @Column('varchar', {
    name: 'bankReferenceNormalized',
    nullable: true,
    length: 128,
  })
  bankReferenceNormalized: string | null;

  @Column('varchar', { name: 'payerName', nullable: true, length: 255 })
  payerName: string | null;

  @Column('varchar', { name: 'customerNote', nullable: true, length: 512 })
  customerNote: string | null;

  @Column('varchar', { name: 'contentSha256', nullable: true, length: 64 })
  contentSha256: string | null;

  @Column('datetime', { name: 'submittedAt' })
  submittedAt: Date;
}
