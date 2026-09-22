import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  MarketplaceImportJobStatus,
  MarketplaceImportRequestType,
} from '../marketplace-import-job.types';

@Entity('marketplace_import_job')
@Index('idx_mij_status_nextAttempt', ['status', 'nextAttemptAt'])
@Index('idx_mij_claimExpires', ['claimExpiresAt'])
@Index('idx_mij_source_product', ['source', 'sourceProductId'])
@Index('idx_mij_claim_priority', ['status', 'priority', 'nextAttemptAt', 'createdAt'])
@Index('uq_mij_publicAccessToken', ['publicAccessToken'], { unique: true })
@Index('uq_mij_activeDedupKey', ['activeDedupKey'], { unique: true })
export class MarketplaceImportJobEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'source', length: 64 })
  source: string;

  @Column('varchar', { name: 'sourceProductId', length: 128 })
  sourceProductId: string;

  @Column('varchar', { name: 'canonicalSourceUrl', length: 512 })
  canonicalSourceUrl: string;

  @Column('enum', {
    name: 'requestType',
    enum: MarketplaceImportRequestType,
    default: MarketplaceImportRequestType.customer,
  })
  requestType: MarketplaceImportRequestType;

  /** Higher values are claimed first (customer USER_IMPORT = 100). */
  @Column('int', { name: 'priority', default: 0 })
  priority: number;

  @Column('enum', {
    name: 'status',
    enum: MarketplaceImportJobStatus,
    default: MarketplaceImportJobStatus.queued,
  })
  status: MarketplaceImportJobStatus;

  @Column('int', { name: 'attemptCount', default: 0 })
  attemptCount: number;

  @Column('int', { name: 'maxAttempts', default: 3 })
  maxAttempts: number;

  @Column('datetime', { name: 'nextAttemptAt', nullable: true })
  nextAttemptAt: Date | null;

  @Column('datetime', { name: 'claimedAt', nullable: true })
  claimedAt: Date | null;

  @Column('datetime', { name: 'claimExpiresAt', nullable: true })
  claimExpiresAt: Date | null;

  @Column('varchar', { name: 'claimToken', nullable: true, length: 64 })
  claimToken: string | null;

  @Column('varchar', { name: 'activeDedupKey', nullable: true, length: 191 })
  activeDedupKey: string | null;

  @Column('datetime', { name: 'startedAt', nullable: true })
  startedAt: Date | null;

  @Column('datetime', { name: 'completedAt', nullable: true })
  completedAt: Date | null;

  @Column('datetime', { name: 'failedAt', nullable: true })
  failedAt: Date | null;

  @Column('int', { name: 'productId', nullable: true })
  productId: number | null;

  @Column('varchar', { name: 'errorCode', nullable: true, length: 64 })
  errorCode: string | null;

  @Column('varchar', { name: 'errorMessage', nullable: true, length: 500 })
  errorMessage: string | null;

  @Column('varchar', { name: 'requesterIpHash', nullable: true, length: 64 })
  requesterIpHash: string | null;

  @Column('varchar', { name: 'publicAccessToken', length: 64 })
  publicAccessToken: string;

  @Column('varchar', {
    name: 'requestCorrelationId',
    nullable: true,
    length: 64,
  })
  requestCorrelationId: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}
