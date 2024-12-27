import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DiscountCouponEntity } from './discount-coupon.entity';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';

@Index('fk_discount_coupon_used_customer1_idx', ['customerId'], {})
@Index('fk_discount_coupon_used_discount_coupon1_idx', ['discountCouponId'], {})
@Entity('discount_coupon_used')
export class DiscountCouponUsedEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('int', { name: 'discountCouponId' })
  discountCouponId: number;

  @Column('decimal', {
    name: 'discountAmount',
    precision: 10,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  discountAmount: number;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  // @ManyToOne(() => CustomerEntity, (customer) => customer.discountCouponUseds, {
  //   onDelete: 'NO ACTION',
  //   onUpdate: 'NO ACTION',
  // })
  // @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  // customer: CustomerEntity;

  @ManyToOne(
    () => DiscountCouponEntity,
    (discountCoupon) => discountCoupon.discountCouponUseds,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'discountCouponId', referencedColumnName: 'id' }])
  discountCoupon: DiscountCouponEntity;

  // @OneToMany(() => OrderEntity, (order) => order.discountCouponUsed)
  // orders: OrderEntity[];
}
