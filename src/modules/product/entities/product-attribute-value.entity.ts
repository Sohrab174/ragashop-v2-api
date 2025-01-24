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
import { AttributeValueEntity } from '../../attribute/entities/attribute-value.entity';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { IncredibleOfferEntity } from '../../incredible-offer/entities/Incredible-offer.entity';
import { OrderItemEntity } from '../../order/entities/order-item.entity';

@Index(
  'fk_product_attribute_value_attribute_value1_idx',
  ['attributeValueId'],
  {},
)
@Index('fk_product_attribute_value_product1_idx', ['productId'], {})
@Entity('product_attribute_value')
export class ProductAttributeValueEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

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
