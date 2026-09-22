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
 * Identity: UNIQUE(sourceCategoryId) — category.id is globally authoritative.
 * `source` is denormalized metadata and must equal category.source (enforced in service).
 */
export enum SourceCategoryMappingStatus {
  active = 'active',
  inactive = 'inactive',
  draft = 'draft',
}

@Unique('uq_source_category_mapping_sourceCategoryId', ['sourceCategoryId'])
@Index('idx_scm_canonicalCategoryId', ['canonicalCategoryId'], {})
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
   * Local imported category.id (authoritative mapping identity).
   * Traceability to (source, sourceId) remains on the Category row.
   */
  @Column('int', { name: 'sourceCategoryId' })
  sourceCategoryId: number;

  @Column('int', { name: 'canonicalCategoryId' })
  canonicalCategoryId: number;

  @Column('enum', {
    name: 'status',
    enum: SourceCategoryMappingStatus,
    default: () => SourceCategoryMappingStatus.active,
  })
  status: SourceCategoryMappingStatus;

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
