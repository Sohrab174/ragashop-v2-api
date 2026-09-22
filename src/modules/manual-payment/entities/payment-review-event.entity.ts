import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('payment_review_event')
export class PaymentReviewEventEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'submissionId' })
  submissionId: number;

  @Column('int', { name: 'actorUserId', nullable: true })
  actorUserId: number | null;

  @Column('int', { name: 'actorCustomerId', nullable: true })
  actorCustomerId: number | null;

  @Column('varchar', { name: 'action', length: 64 })
  action: string;

  @Column('varchar', { name: 'fromStatus', nullable: true, length: 32 })
  fromStatus: string | null;

  @Column('varchar', { name: 'toStatus', nullable: true, length: 32 })
  toStatus: string | null;

  @Column('varchar', { name: 'reasonCode', nullable: true, length: 64 })
  reasonCode: string | null;

  @Column('varchar', { name: 'reasonText', nullable: true, length: 512 })
  reasonText: string | null;

  @Column('json', { name: 'metadataJson', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;
}
