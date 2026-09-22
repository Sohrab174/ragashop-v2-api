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
import { CustomerEntity } from './customer.entity';
import { OrderEntity } from '../../order/entities/order.entity';

@Index('uq_referral_award_orderId', ['orderId'], { unique: true })
@Entity('referral_award')
export class ReferralAwardEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'orderId' })
  orderId: number;

  @Column('int', { name: 'referrerCustomerId' })
  referrerCustomerId: number;

  @Column('int', { name: 'referredCustomerId' })
  referredCustomerId: number;

  @Column('decimal', {
    name: 'walletUSD',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  walletUSD: number;

  @Column('decimal', {
    name: 'walletIRT',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  walletIRT: number;

  @Column('decimal', {
    name: 'walletTRY',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  walletTRY: number;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @ManyToOne(() => OrderEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'orderId', referencedColumnName: 'id' }])
  order: OrderEntity;

  @ManyToOne(() => CustomerEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'referrerCustomerId', referencedColumnName: 'id' }])
  referrerCustomer: CustomerEntity;
}
