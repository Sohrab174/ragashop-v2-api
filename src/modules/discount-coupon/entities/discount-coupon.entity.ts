import {
  BaseEntity,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { DiscountCouponUsedEntity } from './discount-coupon-used.entity';

export enum DiscountCouponTypes {
  percentage = 'percentage',
  fixedAmount = 'fixed_amount',
}

export enum DiscountCouponSections {
  birthday = 'birthday',
}

@Index('fk_discount_coupon_user1_idx', ['createdByUserId'], {})
@Index('fk_discount_coupon_customer1_idx', ['customerId'], {})
@Entity('discount_coupon')
export class DiscountCouponEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'createdByUserId', nullable: true })
  createdByUserId: number | null;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('varchar', { name: 'title', length: 128 })
  title: string;

  @Column('varchar', { name: 'code', length: 45 })
  code: string;

  @Column('enum', {
    name: 'type',
    enum: DiscountCouponTypes,
    default: () => DiscountCouponTypes.percentage,
  })
  type: DiscountCouponTypes;

  @Column('enum', {
    name: 'section',
    nullable: true,
    enum: DiscountCouponSections,
  })
  section: DiscountCouponSections | null;

  @Column('decimal', {
    name: 'amount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  amount: number;

  @Column('decimal', {
    name: 'maxDiscountAmount',
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: new DecimalTransformer(),
  })
  maxDiscountAmount: number | null;

  @Column('decimal', {
    name: 'minPurchaseAmount',
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: new DecimalTransformer(),
  })
  minPurchaseAmount: number | null;

  @Column('datetime', { name: 'startAt', nullable: true })
  startAt: Date | null;

  @Column('datetime', { name: 'endAt', nullable: true })
  endAt: Date | null;

  @Column('int', { name: 'usedCount', default: () => "'0'" })
  usedCount: number;

  @Column('int', { name: 'maxUseCount', default: () => "'-1'" })
  maxUseCount: number;

  @Column('int', { name: 'maxUseCountPerUser', default: () => "'1'" })
  maxUseCountPerUser: number;

  @Column('tinyint', {
    name: 'isActive',
    width: 1,
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  isActive: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt', nullable: true })
  updatedAt: Date | null;

  /**
   * Relations
   */
  // @ManyToOne(() => CustomerEntity, (customer) => customer.discountCoupons, {
  //   onDelete: 'NO ACTION',
  //   onUpdate: 'NO ACTION',
  // })
  // @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  // customer: CustomerEntity;

  @OneToMany(
    () => DiscountCouponUsedEntity,
    (discountCouponUsed) => discountCouponUsed.discountCoupon,
  )
  discountCouponUseds: DiscountCouponUsedEntity[];

  // @ManyToOne(() => UserEntity, (user) => user.discountCoupons, {
  //   onDelete: 'NO ACTION',
  //   onUpdate: 'NO ACTION',
  // })
  // @JoinColumn([{ name: 'createdByUserId', referencedColumnName: 'id' }])
  // createdByUser: UserEntity;
}
