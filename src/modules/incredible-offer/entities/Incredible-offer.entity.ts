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
import { ProductEntity } from '../../product/entities/product.entity';
import { ProductAttributeValueEntity } from '../../product/entities/product-attribute-value.entity';

@Index('fk_incredible_offer_product1_idx', ['productId'], {})
@Index(
  'fk_incredible_offer_product_attribute_value1_idx',
  ['productAttributeValueId'],
  {},
)
@Entity('incredible_offer')
export class IncredibleOfferEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('int', { name: 'productAttributeValueId', nullable: true })
  productAttributeValueId: number | null;

  @Column('decimal', {
    name: 'discountedPrice',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  discountedPrice: number;

  @Column('decimal', {
    name: 'discountPercent',
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  discountPercent: number;

  @Column('datetime', { name: 'fromDate' })
  fromDate: Date;

  @Column('datetime', { name: 'toDate' })
  toDate: Date;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => ProductEntity, (product) => product.incredibleOffers, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @ManyToOne(
    () => ProductAttributeValueEntity,
    (productAttributeValue) => productAttributeValue.incredibleOffers,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'productAttributeValueId', referencedColumnName: 'id' }])
  productAttributeValue: ProductAttributeValueEntity;
}
