import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BrandEntity } from '../../brand/entities/brand.entity';
import { CategoryEntity } from '../../category/entities/category.entity';
import { IncredibleOfferEntity } from '../../incredible-offer/entities/Incredible-offer.entity';
import { PageEntity } from './page.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { ProductEntity } from '../../product/entities/product.entity';
import { PageSectionEntity } from './page-section.entity';

@Index('fk_page_section_item_brand1_idx', ['brandId'], {})
@Index('fk_page_section_item_category1_idx', ['categoryId'], {})
@Index('fk_page_section_item_incredible_offer1_idx', ['incredibleOfferId'], {})
@Index('fk_page_section_item_page1_idx', ['pageId'], {})
@Index('fk_page_section_item_page_section1_idx', ['sectionId'], {})
@Index('fk_page_section_item_product1_idx', ['sectionId'], {})
@Entity('page_section_item')
export class PageSectionItemEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'sectionId' })
  sectionId: number;

  @Column('text', { name: 'primaryContent', nullable: true })
  primaryContent: string | null;

  @Column('text', { name: 'secondaryContent', nullable: true })
  secondaryContent: string | null;

  @Column('varchar', { name: 'buttonContent', nullable: true, length: 128 })
  buttonContent: string | null;

  @Column('text', { name: 'link', nullable: true })
  link: string | null;

  @Column('varchar', { name: 'linkType', nullable: true, length: 45 })
  linkType: string | null;

  @Column('varchar', { name: 'filePath', nullable: true, length: 128 })
  filePath: string | null;

  @Column('int', { name: 'productId', nullable: true })
  productId: number | null;

  @Column('int', { name: 'categoryId', nullable: true })
  categoryId: number | null;

  @Column('int', { name: 'pageId', nullable: true })
  pageId: number | null;

  @Column('int', { name: 'brandId', nullable: true })
  brandId: number | null;

  @Column('int', { name: 'incredibleOfferId', nullable: true })
  incredibleOfferId: number | null;

  @Column('varchar', { name: 'type', nullable: true, length: 45 })
  type: string | null;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

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
  @ManyToOne(() => BrandEntity, (brand) => brand.pageSectionItems, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'brandId', referencedColumnName: 'id' }])
  brand: BrandEntity;

  @ManyToOne(() => ProductEntity, (category) => category.pageSectionItems, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @ManyToOne(() => CategoryEntity, (category) => category.pageSectionItems, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'categoryId', referencedColumnName: 'id' }])
  category: CategoryEntity;

  @ManyToOne(
    () => IncredibleOfferEntity,
    (incredibleOffer) => incredibleOffer.pageSectionItems,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'incredibleOfferId', referencedColumnName: 'id' }])
  incredibleOffer: IncredibleOfferEntity;

  @ManyToOne(() => PageEntity, (page) => page.pageSectionItems, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'pageId', referencedColumnName: 'id' }])
  page: PageEntity;

  @ManyToOne(() => PageSectionEntity, (pageSection) => pageSection.items, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'sectionId', referencedColumnName: 'id' }])
  section: PageSectionEntity;
}
