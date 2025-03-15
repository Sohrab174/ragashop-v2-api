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
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { TransactionEntity } from '../../transaction/entities/transaction.entity';
import { OrderItemEntity } from './order-item.entity';

export enum OrderStatus {
  pending = 'pending',
  accepted = 'accepted',
  rejected = 'rejected',
  paid = 'paid',
  sent = 'sent',
  delivered = 'delivered',
}

@Index('fk_order_customer1_idx', ['customerId'], {})
@Entity('order')
export class OrderEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'number', length: 45 })
  number: string;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('decimal', {
    name: 'amount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  amount: number;

  @Column('decimal', {
    name: 'discount',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  discount: number | null;

  @Column('decimal', {
    name: 'shipping',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  shipping: number;

  @Column('decimal', {
    name: 'tax',
    nullable: true,
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  tax: number | null;

  @Column('decimal', {
    name: 'finalAmount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  finalAmount: number;

  @Column('text', { name: 'address', nullable: true })
  address: string | null;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('enum', {
    name: 'status',
    enum: OrderStatus,
    default: () => OrderStatus.pending,
  })
  status: OrderStatus;

  @Column('varchar', { name: 'reasonRejected', nullable: true, length: 255 })
  reasonRejected: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => CustomerEntity, (customer) => customer.orders, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity;

  @OneToMany(() => OrderItemEntity, (orderItem) => orderItem.order)
  orderItems: OrderItemEntity[];

  @OneToMany(() => TransactionEntity, (transaction) => transaction.order)
  transactions: TransactionEntity[];
}
