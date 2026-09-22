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
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { CartItemEntity } from './cart-item.entity';

@Index('uq_cart_sessionKey', ['sessionKey'], { unique: true })
@Index('uq_cart_customerId', ['customerId'], { unique: true })
@Index('idx_cart_customerId', ['customerId'], {})
@Entity('cart')
export class CartEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'sessionKey', length: 64, nullable: true })
  sessionKey: string | null;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;

  /** Set when this cart was successfully converted to an order (Checkout-1). */
  @Column('int', { name: 'lastConvertedOrderId', nullable: true })
  lastConvertedOrderId: number | null;

  @OneToMany(() => CartItemEntity, (item) => item.cart)
  items: CartItemEntity[];

  @ManyToOne(() => CustomerEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    nullable: true,
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity | null;
}
