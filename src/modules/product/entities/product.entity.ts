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

export enum ProductStatus {
  active = 'active',
  inactive = 'inactive',
}

export enum ProductGender {
  male = 'male',
  female = 'female',
}

export enum ProductType {
  physical = 'physical',
  file = 'file',
  service = 'service',
}

export enum ProductCurrency {
  USD = 'USD',
  TRY = 'TRY',
  IRT = 'IRT',
}

export enum ProductSource {
  trendyol = 'trendyol',
}

@Index('fk_product_category1_idx', ['categoryId'], {})
@Index('fk_product_gallery1_idx', ['coverId'], {})
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

  @Column('int', { name: 'sourceId', nullable: true })
  sourceId: number | null;

  @Column('varchar', { name: 'sourceUrl', nullable: true, length: 255 })
  sourceUrl: string | null;

  @Column('varchar', { name: 'sourceGroupId', nullable: true, length: 128 })
  sourceGroupId: string | null;

  @Column('enum', {
    name: 'source',
    enum: ProductSource,
    default: null,
    nullable: true,
  })
  source: ProductSource;

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
  })
  discountPercent: string | null;

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
}
