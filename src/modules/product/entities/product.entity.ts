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
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../../source-availability';
import {
  ProductCatalogOrigin,
  ProductSupplyType,
} from '../../catalog-lifecycle/catalog-lifecycle.types';
import { ProductCurrency } from '../product-currency';

export { ProductCurrency } from '../product-currency';

export enum ProductStatus {
  active = 'active',
  inactive = 'inactive',
  draft = 'draft',
}

export enum ProductGender {
  male = 'male',
  female = 'female',
  unisex = 'unisex',
}

export enum ProductAgeGroup {
  adult = 'adult',
  child = 'child',
  baby = 'baby',
}

@Index('fk_product_brand1_idx', ['brandId'], {})
@Index('idx_product_categoryId', ['categoryId'], {})
@Index('fk_product_product_gallery1_idx', ['coverId'], {})
@Index('idx_product_sourceGroupId', ['sourceGroupId'], {})
@Index('idx_product_source_sourceId', ['source', 'sourceId'], {})
@Index('idx_product_isDeleted', ['isDeleted'], {})
@Index('product_product_status_idx', ['status'], {})
@Index('idx_product_sourceAvailability', ['sourceAvailability'], {})
@Index(
  'idx_product_sourceSync_attempt',
  ['sourceSyncStatus', 'sourceLastAttemptAt'],
  {},
)
@Index(
  'idx_product_availability_confirmed',
  ['sourceAvailability', 'availabilityLastConfirmedAt'],
  {},
)
@Index('idx_product_catalogOrigin', ['catalogOrigin'], {})
@Index(
  'idx_product_catalog_refresh_select',
  ['catalogOrigin', 'sourceAvailability', 'sourceSyncStatus', 'id'],
  {},
)
@Index('idx_product_supplyType', ['supplyType'], {})
@Index(
  'idx_product_curated_external',
  ['supplyType', 'isCuratedExternalCatalog', 'id'],
  {},
)
@Index(
  'idx_product_curated_refresh_select',
  [
    'supplyType',
    'isCuratedExternalCatalog',
    'sourceAvailability',
    'sourceSyncStatus',
    'id',
  ],
  {},
)
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

  /** Direct acquisition cost per unit (F1). Never from crawler listing price. */
  @Column('decimal', {
    name: 'purchaseCost',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  purchaseCost: number | null;

  /** Landed unit cost for profitability (F1). */
  @Column('decimal', {
    name: 'landedUnitCost',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  landedUnitCost: number | null;

  @Column('enum', {
    name: 'costCurrency',
    enum: ProductCurrency,
    nullable: true,
  })
  costCurrency: ProductCurrency | null;

  @Column('varchar', { name: 'costSource', nullable: true, length: 32 })
  costSource: string | null;

  @Column('datetime', { name: 'costUpdatedAt', nullable: true })
  costUpdatedAt: Date | null;

  @Column('int', { name: 'costUpdatedByUserId', nullable: true })
  costUpdatedByUserId: number | null;

  @Column('int', { name: 'quantity', default: () => "'-1'" })
  quantity: number;

  @Column('enum', { name: 'gender', nullable: true, enum: ProductGender })
  gender: ProductGender | null;

  @Column('enum', {
    name: 'ageGroup',
    enum: ProductAgeGroup,
    nullable: true,
  })
  ageGroup: ProductAgeGroup | null;

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

  @Column('char', { name: 'colorHex', nullable: true, length: 7 })
  colorHex: string | null;

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

  /**
   * Phase A1 source-agnostic commercial availability (bridge toward SourceOffer).
   * Not wired to PLP/PDP/Cart/Checkout in A1 — foundation only.
   */
  @Column('enum', {
    name: 'sourceAvailability',
    enum: SourceCommercialAvailability,
    default: () => SourceCommercialAvailability.unknown,
  })
  sourceAvailability: SourceCommercialAvailability;

  @Column('enum', {
    name: 'sourceSyncStatus',
    enum: SourceSyncStatus,
    default: () => SourceSyncStatus.never_verified,
  })
  sourceSyncStatus: SourceSyncStatus;

  /** Last successful commercial confirmation (available/unavailable/removed). */
  @Column('datetime', { name: 'availabilityLastConfirmedAt', nullable: true })
  availabilityLastConfirmedAt: Date | null;

  /** Last source refresh attempt (success or failure). */
  @Column('datetime', { name: 'sourceLastAttemptAt', nullable: true })
  sourceLastAttemptAt: Date | null;

  /** Last successful source fetch/parse. */
  @Column('datetime', { name: 'sourceLastSuccessAt', nullable: true })
  sourceLastSuccessAt: Date | null;

  /** Last failed source attempt. */
  @Column('datetime', { name: 'sourceLastErrorAt', nullable: true })
  sourceLastErrorAt: Date | null;

  @Column('varchar', {
    name: 'sourceSyncErrorCode',
    nullable: true,
    length: 64,
  })
  sourceSyncErrorCode: string | null;

  @Column('varchar', {
    name: 'sourceSyncErrorDetail',
    nullable: true,
    length: 255,
  })
  sourceSyncErrorDetail: string | null;

  /**
   * @deprecated A3 mutually exclusive origin — staged deprecation.
   * Use supplyType + isCuratedExternalCatalog.
   */
  @Column('enum', {
    name: 'catalogOrigin',
    enum: ProductCatalogOrigin,
    default: () => ProductCatalogOrigin.native_marketplace,
  })
  catalogOrigin: ProductCatalogOrigin;

  /** Inventory ownership: external retailer vs native marketplace vs unclassified. */
  @Column('enum', {
    name: 'supplyType',
    enum: ProductSupplyType,
    default: () => ProductSupplyType.unclassified,
  })
  supplyType: ProductSupplyType;

  /**
   * Curated discovery-pool membership for EXTERNAL products.
   * Independent of paste-link ingestion history.
   */
  @Column('tinyint', {
    name: 'isCuratedExternalCatalog',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isCuratedExternalCatalog: boolean;

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
