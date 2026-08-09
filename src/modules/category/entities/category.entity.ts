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
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { NavMenuEntity } from '../../nav-menu/entities/nav-menu.entity';
import { PageSectionItemEntity } from '../../page/entities/page-section-item.entity';
import { PageSectionEntity } from '../../page/entities/page-section.entity';

export enum CategoryStatus {
  active = 'active',
  inactive = 'inactive',
}

export enum CategoryGender {
  male = 'male',
  female = 'female',
  child = 'child',
  unisex = 'unisex',
}
// isChild boolean to be added

@Index('fk_category_category1_idx', ['parentId'], {})
@Entity('category')
export class CategoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('varchar', { name: 'sourceId', nullable: true, length: 128 })
  sourceId: string | null;

  @Column('int', { name: 'parentId', nullable: true })
  parentId: number | null;

  @Column('varchar', { name: 'sourceName', nullable: true, length: 128 })
  sourceName: string | null;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('varchar', { name: 'iconPath', nullable: true, length: 128 })
  iconPath: string | null;

  @Column('varchar', { name: 'hierarchy', nullable: true, length: 255 })
  hierarchy: string | null;

  @Column('varchar', { name: 'bankTypeId', nullable: true, length: 128 })
  bankTypeId: string | null;

  @Column('varchar', { name: 'bankTypeName', nullable: true, length: 128 })
  bankTypeName: string | null;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('tinyint', {
    name: 'isSelection',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isSelection: boolean;

  @Column('enum', { name: 'gender', nullable: true, enum: CategoryGender })
  gender: CategoryGender | null;

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

  @OneToMany(() => NavMenuEntity, (navMenu) => navMenu.category)
  navMenus: NavMenuEntity[];

  @OneToMany(
    () => PageSectionItemEntity,
    (pageSectionItem) => pageSectionItem.category,
  )
  pageSectionItems: PageSectionItemEntity[];

  @OneToMany(
    () => PageSectionEntity,
    (pageSection) => pageSection.selectedCategory,
  )
  sections: PageSectionEntity[];
}
