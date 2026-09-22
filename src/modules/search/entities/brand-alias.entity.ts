import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BrandEntity } from '../../brand/entities/brand.entity';

/**
 * Data-driven bilingual brand aliases for Search V1.
 * Authoritative for matching; Admin can extend later without Search rewrites.
 */
@Entity('brand_alias')
@Unique('uq_brand_alias_normalized', ['normalizedAlias'])
export class BrandAliasEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Index('idx_brand_alias_brandId')
  @Column('int', { name: 'brandId' })
  brandId: number;

  @Column('varchar', { name: 'alias', length: 128 })
  alias: string;

  @Column('varchar', { name: 'normalizedAlias', length: 128 })
  normalizedAlias: string;

  @ManyToOne(() => BrandEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brandId' })
  brand: BrandEntity;
}
