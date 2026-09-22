import {
  Column,
  Entity,
  BaseEntity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  OneToMany,
} from 'typeorm';
import { ProductEntity } from './product.entity';
import { ProductCurrency } from '../product-currency';
import { AttributeValueEntity } from '../../attribute/entities/attribute-value.entity';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { IncredibleOfferEntity } from '../../incredible-offer/entities/Incredible-offer.entity';
import { OrderItemEntity } from '../../order/entities/order-item.entity';

@Index('idx_pav_attributeValueId', ['attributeValueId'], {})
@Index('idx_pav_productId', ['productId'], {})
@Index('idx_pav_isDeleted', ['isDeleted'], {})
@Index(
  'idx_pav_productId_isDeleted_attributeValueId',
  ['productId', 'isDeleted', 'attributeValueId'],
  {},
)
@Entity('product_attribute_value')
export class ProductAttributeValueEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('int', { name: 'attributeValueId' })
  attributeValueId: number;

  @Column('varchar', { name: 'number', nullable: true, length: 45 })
  number: string | null;

  @Column('int', { name: 'quantity', default: () => "'-1'" })
  quantity: number;

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

  @Column('decimal', {
    name: 'purchaseCost',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  purchaseCost: number | null;

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

  @Column('tinyint', {
    name: 'starred',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  starred: boolean;

  @Column('text', { name: 'sourceDescription', nullable: true })
  sourceDescription: string | null;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('tinyint', {
    name: 'isDeleted',
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  /**
   * Relations
   */
  @ManyToOne(
    () => AttributeValueEntity,
    (attributeValue) => attributeValue.productAttributeValues,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'attributeValueId', referencedColumnName: 'id' }])
  attributeValue: AttributeValueEntity;

  @ManyToOne(() => ProductEntity, (product) => product.productAttributeValues, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @OneToMany(
    () => IncredibleOfferEntity,
    (incredibleOffer) => incredibleOffer.productAttributeValue,
  )
  incredibleOffers: IncredibleOfferEntity[];

  @OneToMany(
    () => OrderItemEntity,
    (orderItem) => orderItem.productAttributeValue,
  )
  orderItems: OrderItemEntity[];
}
