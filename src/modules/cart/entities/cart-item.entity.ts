import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductEntity } from '../../product/entities/product.entity';
import { ProductAttributeValueEntity } from '../../product/entities/product-attribute-value.entity';
import { CartEntity } from './cart.entity';

@Index('uq_cart_item_cart_config', ['cartId', 'configKey'], { unique: true })
@Index('idx_cart_item_cartId', ['cartId'], {})
@Index('idx_cart_item_productId', ['productId'], {})
@Entity('cart_item')
export class CartItemEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'cartId' })
  cartId: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('int', { name: 'productAttributeValueId', nullable: true })
  productAttributeValueId: number | null;

  /**
   * Deterministic line identity: productId + optional PAV id.
   * Format: `{productId}:{pavId|0}`
   */
  @Column('varchar', { name: 'configKey', length: 64 })
  configKey: string;

  @Column('int', { name: 'quantity' })
  quantity: number;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;

  @ManyToOne(() => CartEntity, (cart) => cart.items, {
    onDelete: 'CASCADE',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'cartId', referencedColumnName: 'id' }])
  cart: CartEntity;

  @ManyToOne(() => ProductEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @ManyToOne(() => ProductAttributeValueEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    nullable: true,
  })
  @JoinColumn([{ name: 'productAttributeValueId', referencedColumnName: 'id' }])
  productAttributeValue: ProductAttributeValueEntity | null;
}
