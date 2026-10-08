import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CategoryEntity } from '../../category/entities/category.entity';
import { CanonicalCategoryEntity } from './canonical-category.entity';

/**
 * Source-agnostic mapping: imported Category → CanonicalCategory.
 * Does NOT embed retailer-specific FKs on canonical rows.
 *
 * CAT-MAP-V2-A identity: UNIQUE(sourceCategoryId, genderSlice).
 * V1/legacy Admin writes only genderSlice=any (one destination per source category).
 * Slice-aware discovery is NOT active in V2-A.
 *
 * `source` is denormalized metadata and must equal category.source (enforced in service).
 */
export enum SourceCategoryMappingStatus {
  active = 'active',
  inactive = 'inactive',
  draft = 'draft',
}

/** Product.gender routing slice. Launch V2-A writes only `any`. */
export enum SourceCategoryMappingGenderSlice {
  female = 'female',
  male = 'male',
  unisex = 'unisex',
  any = 'any',
}

/** Migration / human-review state. Not used by storefront discovery in V2-A. */
export enum SourceCategoryMappingReviewStatus {
  legacy_unreviewed = 'legacy_unreviewed',
  reviewed_ok = 'reviewed_ok',
  needs_review = 'needs_review',
  migrated = 'migrated',
}

@Unique('uq_scm_source_category_gender_slice', [
  'sourceCategoryId',
  'genderSlice',
])
@Index('idx_scm_canonical_status_slice', [
  'canonicalCategoryId',
  'status',
  'genderSlice',
])
@Index('idx_scm_review_status', ['reviewStatus', 'status'])
@Index('idx_scm_source', ['source'], {})
@Entity('source_category_mapping')
export class SourceCategoryMappingEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  /**
   * Denormalized marketplace key from category.source.
   * Not part of uniqueness — kept for query convenience / deterministic ordering.
   */
  @Column('varchar', { name: 'source', length: 128 })
  source: string;

  /**
   * Local imported category.id (authoritative mapping source node).
   * Traceability to (source, sourceId) remains on the Category row.
   */
  @Column('int', { name: 'sourceCategoryId' })
  sourceCategoryId: number;

  @Column('int', { name: 'canonicalCategoryId' })
  canonicalCategoryId: number;

  @Column('enum', {
    name: 'genderSlice',
    enum: SourceCategoryMappingGenderSlice,
    default: () => SourceCategoryMappingGenderSlice.any,
  })
  genderSlice: SourceCategoryMappingGenderSlice;

  @Column('enum', {
    name: 'status',
    enum: SourceCategoryMappingStatus,
    default: () => SourceCategoryMappingStatus.active,
  })
  status: SourceCategoryMappingStatus;

  @Column('enum', {
    name: 'reviewStatus',
    enum: SourceCategoryMappingReviewStatus,
    default: () => SourceCategoryMappingReviewStatus.legacy_unreviewed,
  })
  reviewStatus: SourceCategoryMappingReviewStatus;

  /** Optional note for Admin / local prototype documentation. */
  @Column('varchar', { name: 'note', nullable: true, length: 255 })
  note: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updatedAt',
    type: 'datetime',
  })
  updatedAt: Date;

  @ManyToOne(() => CategoryEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'sourceCategoryId', referencedColumnName: 'id' }])
  sourceCategory: CategoryEntity;

  @ManyToOne(
    () => CanonicalCategoryEntity,
    (canonical) => canonical.sourceMappings,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'canonicalCategoryId', referencedColumnName: 'id' }])
  canonicalCategory: CanonicalCategoryEntity;
}
