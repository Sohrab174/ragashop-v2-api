import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { OrderEntity } from './order.entity';
import { ProductEntity } from 'src/modules/product/entities/product.entity';
import { ProductAttributeValueEntity } from 'src/modules/product/entities/product-attribute-value.entity';

@Index('fk_order_item_order1_idx', ['orderId'], {})
@Index(
  'fk_order_item_product_attribute_value1_idx',
  ['productAttributeValueId'],
  {},
)
@Index('fk_order_item_product1_idx', ['productId'], {})
@Entity('order_item')
export class OrderItemEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'orderId' })
  orderId: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('int', { name: 'productAttributeValueId', nullable: true })
  productAttributeValueId: number | null;

  @Column('decimal', {
    name: 'price',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  price: number;

  @Column('decimal', {
    name: 'discountedPrice',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  discountedPrice: number;

  @Column('int', { name: 'quantity', default: () => "'0'" })
  quantity: number;

  @Column('decimal', {
    name: 'finalAmount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  finalAmount: number;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => OrderEntity, (order) => order.orderItems, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'orderId', referencedColumnName: 'id' }])
  order: OrderEntity;

  @ManyToOne(() => ProductEntity, (product) => product.orderItems, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @ManyToOne(
    () => ProductAttributeValueEntity,
    (productAttributeValue) => productAttributeValue.orderItems,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'productAttributeValueId', referencedColumnName: 'id' }])
  productAttributeValue: ProductAttributeValueEntity;
}
