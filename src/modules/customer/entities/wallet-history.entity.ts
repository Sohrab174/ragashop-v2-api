import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CustomerEntity } from './customer.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';

export enum WalletHistoryType {
  buy = 'buy',
  invite = 'invite',
}

@Index('fk_wallet_history_customer1_idx', ['customerId'], {})
@Index('fk_wallet_history_customer2_idx', ['relatedCustomerId'], {})
@Index('fk_wallet_history_order1_idx', ['relatedOrderId'], {})
@Entity('wallet_history', { schema: 'ragashop' })
export class WalletHistoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'customerId' })
  customerId: number;

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

  @Column('int', { name: 'relatedOrderId', nullable: true })
  relatedOrderId: number | null;

  @Column('int', { name: 'relatedCustomerId', nullable: true })
  relatedCustomerId: number | null;

  @Column('enum', {
    name: 'type',
    enum: WalletHistoryType,
    default: () => WalletHistoryType.buy,
  })
  type: WalletHistoryType;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => CustomerEntity, (customer) => customer.walletHistories, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity;

  @ManyToOne(
    () => CustomerEntity,
    (customer) => customer.relatedWalletHistories,
    {
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  )
  @JoinColumn([{ name: 'relatedCustomerId', referencedColumnName: 'id' }])
  relatedCustomer: CustomerEntity;

  @ManyToOne(() => OrderEntity, (order) => order.walletHistories, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'relatedOrderId', referencedColumnName: 'id' }])
  relatedOrder: OrderEntity;
}
