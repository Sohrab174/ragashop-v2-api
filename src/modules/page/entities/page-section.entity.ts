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
import { PageSectionItemEntity } from './page-section-item.entity';
import { PageEntity } from './page.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { JsonTransformer } from '../../../utils/transformers/JsonTransformer';
import { CategoryEntity } from '../../category/entities/category.entity';

export enum PageSectionPosition {
  slider = 'slider',
  miniSlider = 'mini_slider',
  category = 'category',
  brand = 'brand',
  incredibleOffer = 'incredible_offer',
  product = 'product',
  faq = 'faq',
  page = 'page',
}

export enum PageSectionDisplayMode {
  slider = 'slider',
  normal = 'normal',
}

export enum PageSectionProductGender {
  male = 'male',
  female = 'female',
  child = 'child',
  unisex = 'unisex',
}

@Index('fk_page_section_page1_idx', ['pageId'], {})
@Index('fk_page_section_category1', ['selectedCategoryId'], {})
@Entity('page_section', { schema: 'ragashop' })
export class PageSectionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'pageId' })
  pageId: number;

  @Column('enum', {
    name: 'position',
    enum: PageSectionPosition,
    default: () => PageSectionPosition.product,
  })
  position: PageSectionPosition;

  @Column('text', { name: 'primaryContent', nullable: true })
  primaryContent: string | null;

  @Column('text', { name: 'link', nullable: true })
  link: string | null;

  @Column('enum', {
    name: 'displayMode',
    enum: PageSectionDisplayMode,
    default: () => PageSectionDisplayMode.normal,
  })
  displayMode: PageSectionDisplayMode;

  @Column('varchar', {
    name: 'selectedTags',
    nullable: true,
    length: 128,
    transformer: new JsonTransformer(),
  })
  selectedTags: any | null;

  @Column('int', { name: 'selectedCategoryId', nullable: true })
  selectedCategoryId: number | null;

  @Column('enum', {
    name: 'productGender',
    enum: PageSectionProductGender,
    nullable: true,
  })
  productGender: PageSectionProductGender | null;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('tinyint', {
    name: 'isPublished',
    width: 1,
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  isPublished: boolean;

  @Column('tinyint', {
    name: 'isDeleted',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt', nullable: true })
  updatedAt: Date | null;

  /**
   * Relations
   */
  @OneToMany(
    () => PageSectionItemEntity,
    (pageSectionItem) => pageSectionItem.section,
  )
  items: PageSectionItemEntity[];

  @ManyToOne(() => PageEntity, (page) => page.sections, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'pageId', referencedColumnName: 'id' }])
  page: PageEntity;

  @ManyToOne(() => CategoryEntity, (page) => page.sections, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'selectedCategoryId', referencedColumnName: 'id' }])
  selectedCategory: CategoryEntity;
}
