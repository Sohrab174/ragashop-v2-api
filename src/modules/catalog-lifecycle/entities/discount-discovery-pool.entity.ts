import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DiscountPoolEntryStatus {
  active = 'active',
  expired = 'expired',
  rejected = 'rejected',
}

/**
 * Rotating verified-discount pool for promotional rails.
 * Ordinary showcase membership is independent (curated product rows remain).
 */
@Entity('discount_discovery_pool')
export class DiscountDiscoveryPoolEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Index('uq_discount_pool_product', { unique: true })
  @Column('int', { name: 'productId' })
  productId: number;

  @Column('varchar', { name: 'source', length: 32, default: 'trendyol' })
  source: string;

  @Index('idx_discount_pool_source_product')
  @Column('varchar', { name: 'sourceProductId', length: 64 })
  sourceProductId: string;

  @Column('varchar', { name: 'categoryName', length: 128, nullable: true })
  categoryName: string | null;

  @Column('decimal', {
    name: 'listingDiscountPct',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  listingDiscountPct: number | null;

  @Column('decimal', {
    name: 'verifiedDiscountPct',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  verifiedDiscountPct: number | null;

  @Column('varchar', { name: 'flashTags', length: 255, nullable: true })
  flashTags: string | null;

  @Column('datetime', { name: 'campaignWindowEndsAt', nullable: true })
  campaignWindowEndsAt: Date | null;

  @Column('datetime', { name: 'displayExpiresAt', nullable: true })
  displayExpiresAt: Date | null;

  @Column('datetime', { name: 'verifiedAt', nullable: true })
  verifiedAt: Date | null;

  @Column('enum', {
    name: 'status',
    enum: DiscountPoolEntryStatus,
    default: DiscountPoolEntryStatus.active,
  })
  status: DiscountPoolEntryStatus;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt: Date;
}
