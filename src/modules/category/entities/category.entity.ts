import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductEntity } from '../../product/entities/product.entity';

export enum CategoryStatus {
  active = 'active',
  inactive = 'inactive',
}

@Index('fk_category_category1_idx', ['parentId'], {})
@Entity('category')
export class CategoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'sourceId', nullable: true })
  sourceId: number | null;

  @Column('int', { name: 'parentId', nullable: true })
  parentId: number | null;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('varchar', { name: 'iconPath', nullable: true, length: 128 })
  iconPath: string | null;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('tinyint', { name: 'isSelection', width: 1, default: () => "'0'" })
  isSelection: boolean;

  @Column('enum', {
    name: 'status',
    enum: CategoryStatus,
    default: () => CategoryStatus.active,
  })
  status: CategoryStatus;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */

  @OneToMany(() => ProductEntity, (product) => product.category)
  products: ProductEntity[];

  @ManyToOne(() => CategoryEntity, (category) => category.subCategories, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'parentId', referencedColumnName: 'id' }])
  parent: CategoryEntity;

  @OneToMany(() => CategoryEntity, (category) => category.parent)
  subCategories: CategoryEntity[];
}
