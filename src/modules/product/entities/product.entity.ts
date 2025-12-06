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
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { CategoryEntity } from '../../category/entities/category.entity';
import { ProductGalleryEntity } from './product-gallery.entity';
import { ProductAttributeValueEntity } from './product-attribute-value.entity';
import { IncredibleOfferEntity } from '../../incredible-offer/entities/Incredible-offer.entity';
import { BrandEntity } from '../../brand/entities/brand.entity';
import { OrderItemEntity } from '../../order/entities/order-item.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { ProductDescriptionEntity } from './product-description.entity';
import { PageSectionItemEntity } from '../../page/entities/page-section-item.entity';
import { ProductFavoriteEntity } from '../../favorite/entities/product-favorite.entity';

export enum ProductStatus {
  active = 'active',
  inactive = 'inactive',
  draft = 'draft',
}

export enum ProductGender {
  male = 'male',
  female = 'female',
  child = 'child',
  unisex = 'unisex',
}

export enum ProductCurrency {
  USD = 'USD',
  TRY = 'TRY',
  IRT = 'IRT',
}

@Index('fk_product_brand1_idx', ['brandId'], {})
@Index('fk_product_category1_idx', ['categoryId'], {})
@Index('fk_product_product_gallery1_idx', ['coverId'], {})
@Index('fk_product_product_sourceGroupId_idx', ['sourceGroupId'], {})
@Index('product_product_isDeleted_idx', ['isDeleted'], {})
@Index('product_product_status_idx', ['status'], {})
@Entity('product')
export class ProductEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'number', nullable: true, length: 45 })
  number: string;

  @Column('int', { name: 'categoryId' })
  categoryId: number;

  @Column('int', { name: 'brandId', nullable: true })
  brandId: number | null;

  @Column('varchar', { name: 'sourceId', nullable: true, length: 128 })
  sourceId: string | null;

  @Column('varchar', { name: 'sourceUrl', nullable: true, length: 255 })
  sourceUrl: string | null;

  @Column('varchar', { name: 'sourceGroupId', nullable: true, length: 128 })
  sourceGroupId: string | null;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('varchar', { name: 'sourceName', nullable: true, length: 255 })
  sourceName: string | null;

  @Column('int', { name: 'coverId', nullable: true })
  coverId: number | null;

  @Column('varchar', { name: 'code', nullable: true, length: 45 })
  code: string | null;

  @Column('enum', {
    name: 'currency',
    enum: ProductCurrency,
    default: () => ProductCurrency.TRY,
  })
  currency: ProductCurrency;

  @Column('decimal', {
    name: 'price',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  price: number | null;

  @Column('decimal', {
    name: 'discountedPrice',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  discountedPrice: number | null;

  @Column('decimal', {
    name: 'discountPercent',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  discountPercent: number | null;

  @Column('int', { name: 'quantity', default: () => "'-1'" })
  quantity: number;

  @Column('enum', { name: 'gender', nullable: true, enum: ProductGender })
  gender: ProductGender | null;

  @Column('decimal', {
    name: 'star',
    default: () => "'0'",
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  star: number;

  @Column('int', { name: 'starCountPerson', default: () => "'0'" })
  starCountPerson: number;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('text', { name: 'sourceDescription', nullable: true })
  sourceDescription: string | null;

  @Column('varchar', { name: 'color', nullable: true, length: 128 })
  color: string | null;

  @Column('varchar', { name: 'sizeChartUrl', nullable: true, length: 255 })
  sizeChartUrl: string | null;

  @Column('tinyint', {
    name: 'isVasEnabled',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isVasEnabled: boolean;

  @Column('decimal', {
    name: 'tax',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  tax: number | null;

  @Column('tinyint', {
    name: 'isSellable',
    width: 1,
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  isSellable: boolean;

  @Column('tinyint', {
    name: 'isBasketDiscount',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isBasketDiscount: boolean;

  @Column('tinyint', {
    name: 'hasStock',
    width: 1,
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  hasStock: boolean;

  @Column('tinyint', {
    name: 'isFreeCargo',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isFreeCargo: boolean;

  @Column('int', { name: 'favoriteCount', default: () => "'0'" })
  favoriteCount: number;

  @Column('varchar', { name: 'uxLayout', nullable: true, length: 128 })
  uxLayout: string | null;

  @Column('tinyint', {
    name: 'isDigitalGood',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDigitalGood: boolean;

  @Column('tinyint', {
    name: 'isArtWork',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isArtWork: boolean;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('enum', {
    name: 'status',
    enum: ProductStatus,
    default: () => ProductStatus.active,
  })
  status: ProductStatus;

  @Column('datetime', { name: 'lastCrawlingAt', nullable: true })
  lastCrawlingAt: Date | null;

  @Column('tinyint', {
    name: 'isDeleted',
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @OneToMany(
    () => IncredibleOfferEntity,
    (incredibleOffer) => incredibleOffer.product,
  )
  incredibleOffers: IncredibleOfferEntity[];

  @ManyToOne(() => BrandEntity, (brand) => brand.products, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'brandId', referencedColumnName: 'id' }])
  brand: BrandEntity;

  @ManyToOne(() => CategoryEntity, (category) => category.products, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'categoryId', referencedColumnName: 'id' }])
  category: CategoryEntity;

  @ManyToOne(() => ProductGalleryEntity, (gallery) => gallery.products, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'coverId', referencedColumnName: 'id' }])
  cover: ProductGalleryEntity;

  @OneToMany(
    () => ProductAttributeValueEntity,
    (productAttributeValue) => productAttributeValue.product,
  )
  productAttributeValues: ProductAttributeValueEntity[];

  @OneToMany(
    () => ProductGalleryEntity,
    (productGallery) => productGallery.product,
  )
  productGalleries: ProductGalleryEntity[];

  @OneToMany(() => OrderItemEntity, (orderItem) => orderItem.product)
  orderItems: OrderItemEntity[];

  @OneToMany(
    () => ProductDescriptionEntity,
    (productDescription) => productDescription.product,
  )
  productDescriptions: ProductDescriptionEntity[];

  @OneToMany(
    () => PageSectionItemEntity,
    (pageSectionItem) => pageSectionItem.product,
  )
  pageSectionItems: PageSectionItemEntity[];

  @OneToMany(
    () => ProductFavoriteEntity,
    (productFavorite) => productFavorite.product,
  )
  favorites: ProductFavoriteEntity[];
}
