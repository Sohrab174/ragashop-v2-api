import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SourceCategoryMappingEntity } from './source-category-mapping.entity';

/**
 * RagaShop-owned customer shopping taxonomy.
 * Distinct from imported source `category` rows.
 */
export enum CanonicalCategoryStatus {
  active = 'active',
  inactive = 'inactive',
}

@Index('idx_canonical_category_parentId', ['parentId'], {})
@Index('idx_canonical_category_status_order', ['status', 'displayOrder'], {})
@Entity('canonical_category')
export class CanonicalCategoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'parentId', nullable: true })
  parentId: number | null;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('enum', {
    name: 'status',
    enum: CanonicalCategoryStatus,
    default: () => CanonicalCategoryStatus.active,
  })
  status: CanonicalCategoryStatus;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  /** Explicit presentation image path (optional). */
  @Column('varchar', { name: 'imagePath', nullable: true, length: 255 })
  imagePath: string | null;

  /**
   * Optional audience hint for future merchandising — not used as virtual roots.
   * Nullable; not required for navigation.
   */
  @Column('varchar', { name: 'audience', nullable: true, length: 64 })
  audience: string | null;

  /**
   * Marks LOCAL DEVELOPMENT / UX PROTOTYPE seed rows for easy replacement.
   * Production taxonomy should set this false / null via Admin later.
   */
  @Column('tinyint', {
    name: 'isLocalPrototype',
    width: 1,
    default: () => "'0'",
  })
  isLocalPrototype: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updatedAt',
    type: 'datetime',
  })
  updatedAt: Date;

  @ManyToOne(() => CanonicalCategoryEntity, (category) => category.children, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'parentId', referencedColumnName: 'id' }])
  parent: CanonicalCategoryEntity;

  @OneToMany(() => CanonicalCategoryEntity, (category) => category.parent)
  children: CanonicalCategoryEntity[];

  @OneToMany(
    () => SourceCategoryMappingEntity,
    (mapping) => mapping.canonicalCategory,
  )
  sourceMappings: SourceCategoryMappingEntity[];
}
